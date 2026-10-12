package com.travellier.app;

import static org.junit.Assert.*;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.MediaStore;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import java.util.regex.Matcher;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.After;
import org.junit.Before;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

/** Runs the production JS adapters through the real Capacitor bridge, without a test route. */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class NativeCapabilitiesSmokeTest {
    private static final String APP = "com.travellier.app";
    private static final long TIMEOUT = 30000;
    private UiDevice device;
    private Context context;
    private ActivityScenario<MainActivity> scenario;
    private Uri fixtureImage;

    @Before public void launchFreshPermissionState() throws Exception {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        // Permission reset is restricted to disposable emulators, never a real user's device.
        assertEquals("Use a disposable emulator", "1", device.executeShellCommand("getprop ro.kernel.qemu").trim());
        // The runner resets permissions outside instrumentation. Revoking a granted permission
        // here kills our own process; consequently the grant case deliberately runs last.
        scenario = ActivityScenario.launch(MainActivity.class);
        awaitJavascript("document.readyState === 'complete' && document.getElementById('root').childElementCount > 0");
    }

    @After public void cleanup() throws Exception {
        if (fixtureImage != null) device.executeShellCommand("content delete --uri " + fixtureImage);
        if (scenario != null) scenario.close();
    }

    @Test public void a_startupAndCalendarCheckDoNotPrompt() throws Exception {
        assertFalse(granted(Manifest.permission.READ_CALENDAR));
        assertFalse(granted(Manifest.permission.WRITE_CALENDAR));
        assertNoPermissionDialog();
        installAdapterBundle();
        begin("calendar.checkAccess()");
        JSONObject result = awaitResult();
        assertTrue(result.toString(), result.getBoolean("ok"));
        assertNotEquals("granted", result.getJSONObject("value").getString("read"));
        assertNotEquals("granted", result.getJSONObject("value").getString("write"));
        assertNoPermissionDialog();
        evidence("startup-no-dialog", result);
    }

    @Test public void e_calendarPermissionCanBeGrantedInContext() throws Exception {
        installAdapterBundle();
        begin("calendar.requestAccess('manage')");
        permissionButton("permission_allow_button").click();
        JSONObject result = awaitResult();
        assertTrue(result.toString(), result.getBoolean("ok"));
        assertEquals("granted", result.getJSONObject("value").getString("read"));
        assertEquals("granted", result.getJSONObject("value").getString("write"));
        assertTrue(granted(Manifest.permission.READ_CALENDAR));
        assertTrue(granted(Manifest.permission.WRITE_CALENDAR));
        evidence("calendar-granted", result);
    }

    @Test public void d_calendarDenialDoesNotClaimAccess() throws Exception {
        installAdapterBundle();
        begin("calendar.requestAccess('manage')");
        permissionButton("permission_deny_button").click();
        JSONObject result = awaitResult();
        assertTrue(result.toString(), result.getBoolean("ok"));
        assertNotEquals("granted", result.getJSONObject("value").getString("read"));
        assertNotEquals("granted", result.getJSONObject("value").getString("write"));
        assertFalse(granted(Manifest.permission.READ_CALENDAR));
        assertFalse(granted(Manifest.permission.WRITE_CALENDAR));
        evidence("calendar-denied", result);
    }

    @Test public void b_capturesAnActualPhotoThroughNativeCamera() throws Exception {
        installAdapterBundle();
        begin("photos.select('camera')");
        dismissExternalCameraPermissions();
        UiObject2 shutter = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/shutter_button"))), TIMEOUT);
        if (shutter == null) shutter = device.findObject(By.desc(Pattern.compile("(?i).*(shutter|capture|take photo).*")));
        if (shutter == null) diagnostic("camera-missing-shutter");
        assertNotNull("Native camera shutter not found", shutter);
        screenshot("camera-open");
        shutter.click();
        UiObject2 done = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/(done_button|btn_done|review_done)"))), 5000);
        if (done == null) done = device.findObject(By.desc(Pattern.compile("(?i)(done|save|ok)")));
        if (done == null) done = device.findObject(By.text(Pattern.compile("(?i)(done|save|ok)")));
        if (done != null) done.click();
        JSONObject result = awaitResult();
        assertPhotoReadable(result);
        evidence("camera-captured", result);
    }

    @Test public void c_selectsAnActualPhotoWithoutBroadStoragePermission() throws Exception {
        seedPhoto();
        installAdapterBundle();
        begin("photos.select('gallery')");
        UiObject2 photo = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/icon_thumbnail"))), 10000);
        if (photo == null) photo = device.findObject(By.desc(Pattern.compile("(?i)^photo taken.*")));
        if (photo == null) {
            UiObject2 images = device.findObject(By.text(Pattern.compile("(?i)images")));
            if (images == null) {
                UiObject2 menu = device.findObject(By.desc(Pattern.compile("(?i)(show roots|navigate up)")));
                if (menu != null) menu.click();
                images = device.wait(Until.findObject(By.text(Pattern.compile("(?i)images"))), 5000);
            }
            if (images != null) images.click();
            UiObject2 pictures = device.wait(Until.findObject(By.text("Pictures")), 2000);
            if (pictures != null) pictures.click();
            photo = device.wait(Until.findObject(By.text(Pattern.compile(".*t46-smoke.*"))), 10000);
            if (photo == null) photo = device.findObject(By.res(Pattern.compile(".*:id/icon_thumb")));
        }
        if (photo == null) diagnostic("gallery-missing-image");
        assertNotNull("Seeded image missing from native picker", photo);
        screenshot("gallery-open");
        photo.click();
        UiObject2 confirm = device.wait(Until.findObject(By.text(Pattern.compile("(?i)(add|open|select)(.*)"))), 3000);
        if (confirm != null) confirm.click();
        JSONObject result = awaitResult();
        assertPhotoReadable(result);
        assertFalse(granted(Manifest.permission.READ_EXTERNAL_STORAGE));
        assertFalse(granted(Manifest.permission.WRITE_EXTERNAL_STORAGE));
        evidence("gallery-selected", result);
    }

    private boolean granted(String permission) {
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private UiObject2 permissionButton(String id) {
        UiObject2 button = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/" + id))), TIMEOUT);
        assertNotNull("Permission dialog button not found: " + id, button);
        return button;
    }

    private void assertNoPermissionDialog() {
        assertFalse("Startup unexpectedly prompts for permission", device.wait(Until.hasObject(By.res(Pattern.compile(".*:id/permission_(allow|deny).*"))), 1500));
        assertEquals(APP, device.getCurrentPackageName());
    }

    private void dismissExternalCameraPermissions() {
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (SystemClock.uptimeMillis() < deadline) {
            UiObject2 next = device.findObject(By.res("com.android.camera2:id/confirm_button"));
            if (next != null) {
                UiObject2 locations = device.findObject(By.res("com.android.camera2:id/check_box"));
                if (locations != null && locations.isChecked()) locations.click();
                next.click();
                SystemClock.sleep(200);
                continue;
            }
            UiObject2 button = device.findObject(By.res(Pattern.compile(".*:id/permission_allow.*")));
            if (button != null) { button.click(); SystemClock.sleep(250); }
            else if (device.hasObject(By.res(Pattern.compile(".*:id/shutter_button")))) return;
            else SystemClock.sleep(200);
        }
    }

    private Object javascript(String code) throws Exception {
        AtomicReference<String> response = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(code, value -> { response.set(value); latch.countDown(); }));
        assertTrue("WebView did not respond", latch.await(10, TimeUnit.SECONDS));
        return new JSONTokener(response.get()).nextValue();
    }

    private void awaitJavascript(String condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + TIMEOUT;
        while (SystemClock.uptimeMillis() < deadline) {
            if (Boolean.TRUE.equals(javascript(condition))) return;
            SystemClock.sleep(100);
        }
        fail("WebView condition timed out: " + condition);
    }

    private void installAdapterBundle() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream source = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("native-smoke.js")) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = source.read(buffer)) != -1) bytes.write(buffer, 0, count);
        }
        javascript(bytes.toString(StandardCharsets.UTF_8.name()));
        assertEquals(Boolean.TRUE, javascript("!!window.__t46Native"));
    }

    private void begin(String operation) throws Exception {
        javascript("window.__t46Result = null; window.__t46Native." + operation + ".then(value => window.__t46Result = JSON.stringify(value)).catch(error => window.__t46Result = JSON.stringify({fatal: String(error)}));");
    }

    private JSONObject awaitResult() throws Exception {
        long deadline = SystemClock.uptimeMillis() + TIMEOUT;
        while (SystemClock.uptimeMillis() < deadline) {
            Object result = javascript("window.__t46Result");
            if (result instanceof String) return new JSONObject((String) result);
            SystemClock.sleep(100);
        }
        screenshot("timeout");
        File hierarchy = new File(evidenceDirectory(), "timeout-api" + Build.VERSION.SDK_INT + ".xml");
        device.dumpWindowHierarchy(hierarchy);
        persist(hierarchy);
        throw new AssertionError("Native operation did not return within " + TIMEOUT + "ms");
    }

    private void assertPhotoReadable(JSONObject result) throws Exception {
        assertTrue(result.toString(), result.getBoolean("ok"));
        JSONArray photos = result.getJSONArray("value");
        assertTrue("No photo returned", photos.length() > 0);
        Uri reference = Uri.parse(photos.getJSONObject(0).getString("reference"));
        try (InputStream image = reference.getScheme() == null || "file".equals(reference.getScheme()) ? new FileInputStream(reference.getPath()) : context.getContentResolver().openInputStream(reference)) {
            Bitmap decoded = BitmapFactory.decodeStream(image);
            assertNotNull("Native photo is not decodable", decoded);
            assertTrue(decoded.getWidth() > 0 && decoded.getHeight() > 0);
            decoded.recycle();
        }
    }

    private void seedPhoto() throws Exception {
        // Shell fixture seeding also works on API 24; the app never gains broad storage access.
        File image = new File(context.getExternalFilesDir(null), "t46-fixture.jpg");
        String imageName = "t46-smoke-" + System.nanoTime() + ".jpg";
        Bitmap bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(0xff2376dd);
        try (OutputStream output = new FileOutputStream(image)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output));
        }
        bitmap.recycle();
        device.executeShellCommand("mkdir -p /sdcard/Pictures");
        device.executeShellCommand("cp " + image.getAbsolutePath() + " /sdcard/Pictures/" + imageName);
        device.executeShellCommand("am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/" + imageName);
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (SystemClock.uptimeMillis() < deadline) {
            String rows = device.executeShellCommand("content query --uri " + MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                + " --projection _id:_display_name:_size");
            for (String row : rows.split("\\n")) {
                Matcher id = Pattern.compile("_id=(\\d+)").matcher(row);
                Matcher size = Pattern.compile("_size=(\\d+)").matcher(row);
                if (row.contains(imageName) && size.find() && Long.parseLong(size.group(1)) > 0 && id.find()) {
                    fixtureImage = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.group(1));
                    return;
                }
            }
            SystemClock.sleep(100);
        }
        fail("Media scanner did not index the test image");
    }

    private File evidenceDirectory() {
        File directory = new File(context.getExternalFilesDir(null), "t46-smoke");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        return directory;
    }

    private void screenshot(String name) throws Exception {
        File capture = new File(evidenceDirectory(), "api" + Build.VERSION.SDK_INT + "-" + name + ".png");
        assertTrue(device.takeScreenshot(capture));
        persist(capture);
    }

    private void diagnostic(String name) throws Exception {
        screenshot(name);
        File hierarchy = new File(evidenceDirectory(), "api" + Build.VERSION.SDK_INT + "-" + name + ".xml");
        device.dumpWindowHierarchy(hierarchy);
        persist(hierarchy);
    }

    private void persist(File evidence) throws Exception {
        device.executeShellCommand("mkdir -p /sdcard/Download/t46-smoke");
        device.executeShellCommand("cp " + evidence.getAbsolutePath() + " /sdcard/Download/t46-smoke/" + evidence.getName());
    }

    private void evidence(String name, JSONObject result) throws Exception {
        result.put("apiLevel", Build.VERSION.SDK_INT);
        File report = new File(evidenceDirectory(), "api" + Build.VERSION.SDK_INT + "-" + name + ".json");
        try (FileOutputStream output = new FileOutputStream(report)) {
            output.write(result.toString(2).getBytes(StandardCharsets.UTF_8));
        }
        persist(report);
        screenshot(name);
    }
}
