import { MediaType, MediaTypeSelection } from "@capacitor/camera";
import { NativeCapabilityError, type PhotoSourcePort, type SelectedPhoto } from "app-domain";
import type { NativeDependencies, NativePlatform } from "./capabilities.js";
import { nativeResult } from "./native-result.js";

export function createPhotoSource(camera: NativeDependencies["camera"], platform: NativePlatform): PhotoSourcePort {
  return {
    checkPermission: (source) => nativeResult(platform, async () => {
      const permissions = await camera.checkPermissions();
      return source === "camera" ? permissions.camera : permissions.photos;
    }),
    select: (source) => nativeResult(platform, async () => {
      // Android launches the system camera; pickers grant access to chosen files.
      // Do not request broad photo-library/storage access for a system picker.
      if (source === "camera" && platform() === "ios") {
        let { camera: permission } = await camera.checkPermissions();
        if (permission === "prompt" || permission === "prompt-with-rationale") {
          permission = (await camera.requestPermissions({ permissions: ["camera"] })).camera;
        }
        if (permission !== "granted") throw new NativeCapabilityError("denied");
      }
      if (source === "gallery" && platform() === "android") {
        // Camera 8.2.5 chooseFromGallery can leave its native loading activity open
        // for small images (ionic-team/capacitor-camera#55). Its bundled legacy
        // picker uses the same system selection without that loading activity.
        const { photos } = await camera.pickImages({}).catch((error: unknown) => {
          const message = typeof error === "object" && error !== null && "message" in error ? error.message : undefined;
          if (message === "User cancelled photos app") throw new NativeCapabilityError("cancelled");
          if (message === "SecurityException") throw new NativeCapabilityError("denied");
          throw error;
        });
        if (!photos.length) throw new NativeCapabilityError("cancelled");
        return photos.map((photo): SelectedPhoto => {
          if (!photo.path) throw new NativeCapabilityError("native");
          return { reference: photo.path, previewUrl: photo.webPath, format: photo.format };
        });
      }
      const results = source === "camera"
        ? [await camera.takePhoto({ saveToGallery: false, includeMetadata: true })]
        : (await camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, allowMultipleSelection: true, includeMetadata: true })).results;
      if (!results.length) throw new NativeCapabilityError("cancelled");
      return results.map((media): SelectedPhoto => {
        if (media.type !== MediaType.Photo || !media.uri) throw new NativeCapabilityError("native");
        return {
          reference: media.uri,
          ...(media.webPath ? { previewUrl: media.webPath } : {}),
          ...(media.metadata?.format ? { format: media.metadata.format } : {}),
        };
      });
    }),
  };
}
