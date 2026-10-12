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
