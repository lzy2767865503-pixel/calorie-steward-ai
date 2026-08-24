import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

type ModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

const moduleLoader = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleLoader._load;
let invalidCameraDirectory = false;

moduleLoader._load = (request, parent, isMain) => {
  if (request === "expo-file-system/legacy") {
    return {
      documentDirectory: "file:///app/documents/",
      cacheDirectory: "file:///app/cache/",
      getInfoAsync: async (uri: string) => ({
        exists: true,
        isDirectory:
          !(invalidCameraDirectory && uri === "file:///app/cache/Camera/"),
      }),
      readDirectoryAsync: async (uri: string) =>
        uri.endsWith("Camera/")
          ? [
              "11111111-1111-4111-8111-111111111111.jpg",
              "22222222-2222-4222-8222-222222222222.mp4",
              "not-a-capture.jpg",
              "..%2fsecret.jpg",
            ]
          : [
              "33333333-3333-4333-8333-333333333333.JPG",
              "44444444-4444-4444-8444-444444444444.png",
              "nested/55555555-5555-4555-8555-555555555555.jpg",
            ],
      makeDirectoryAsync: async () => undefined,
      copyAsync: async () => undefined,
      deleteAsync: async () => undefined,
      writeAsStringAsync: async () => undefined,
      EncodingType: { UTF8: "utf8" },
    };
  }
  if (request === "expo-file-system") {
    return { File: class {} };
  }
  if (request === "expo-crypto") {
    return {
      CryptoDigestAlgorithm: { SHA256: "SHA-256" },
      digest: async () => new ArrayBuffer(32),
    };
  }
  return originalLoad(request, parent, isMain);
};

const { listTransientCapturePhotoUris } = require("./photoFiles") as typeof import("./photoFiles");
moduleLoader._load = originalLoad;

test("startup scan returns only strict app-cache camera and manipulator JPEGs", async () => {
  assert.deepEqual(await listTransientCapturePhotoUris(), [
    "file:///app/cache/Camera/11111111-1111-4111-8111-111111111111.jpg",
    "file:///app/cache/ImageManipulator/33333333-3333-4333-8333-333333333333.JPG",
  ]);
});

test("startup scan fails closed if a capture family path is not a directory", async () => {
  invalidCameraDirectory = true;
  await assert.rejects(
    listTransientCapturePhotoUris(),
    /拍摄缓存目录结构异常/,
  );
  invalidCameraDirectory = false;
});
