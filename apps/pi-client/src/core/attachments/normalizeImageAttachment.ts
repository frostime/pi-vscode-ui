import type { RpcImageContent } from "@frostime/pi-rpc";

import type { WebviewImageInput } from "../../shared/bridge/webviewToHost.js";
import type { ImageAttachmentView } from "../../shared/model/conversationModel.js";

const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function normalizeImageAttachments(images: WebviewImageInput[], maxBytes: number): RpcImageContent[] {
  return images.map((image) => {
    if (!SUPPORTED_MIME_TYPES.has(image.mimeType)) throw new Error(`Unsupported image type: ${image.mimeType}`);
    if (!BASE64_PATTERN.test(image.data)) throw new Error(`${image.name} contains invalid Base64 image data.`);
    const decodedBytes = Buffer.byteLength(image.data, "base64");
    if (decodedBytes <= 0) throw new Error(`${image.name} is empty.`);
    if (decodedBytes > maxBytes || image.size > maxBytes) {
      throw new Error(`${image.name} exceeds the ${formatBytes(maxBytes)} image limit.`);
    }
    const declaredDifference = Math.abs(decodedBytes - image.size);
    if (declaredDifference > Math.max(1024, Math.ceil(decodedBytes * 0.02))) {
      throw new Error(`${image.name} has inconsistent image size metadata.`);
    }
    return { type: "image", data: image.data, mimeType: image.mimeType };
  });
}

export function validateProjectedImageAttachments(
  images: readonly ImageAttachmentView[],
  maxImages: number,
  maxBytes: number,
): ImageAttachmentView[] {
  if (images.length > maxImages) {
    throw new Error(`This message has more than ${maxImages} images and cannot be restored exactly.`);
  }
  const inputs = images.map(projectedImageInput);
  normalizeImageAttachments(inputs, maxBytes);
  return images.map((image) => ({ ...image }));
}

function projectedImageInput(image: ImageAttachmentView): WebviewImageInput {
  if (!SUPPORTED_MIME_TYPES.has(image.mimeType)) throw new Error(`Unsupported image type: ${image.mimeType}`);
  const prefix = `data:${image.mimeType};base64,`;
  if (!image.dataUrl.startsWith(prefix)) throw new Error(`${image.name} has invalid image data.`);
  return {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType as WebviewImageInput["mimeType"],
    data: image.dataUrl.slice(prefix.length),
    size: image.size,
  };
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}
