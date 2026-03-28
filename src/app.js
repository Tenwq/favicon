import QRCode from "qrcode";

const OUTPUT_SIZES = [16, 32, 48, 64, 128];

const elements = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  downloadButton: document.getElementById("downloadButton"),
  roundedToggle: document.getElementById("roundedToggle"),
  themeButtons: document.querySelectorAll("[data-theme-preference]"),
  shareButtons: document.querySelectorAll("[data-share-platform]"),
  shareStatus: document.getElementById("shareStatus"),
  qrModal: document.getElementById("qrModal"),
  qrBackdrop: document.getElementById("qrBackdrop"),
  qrCloseButton: document.getElementById("qrCloseButton"),
  qrImage: document.getElementById("qrImage"),
  qrLinkText: document.getElementById("qrLinkText"),
  statusText: document.getElementById("statusText"),
  previewImage: document.getElementById("previewImage"),
  previewPlaceholder: document.getElementById("previewPlaceholder"),
  fileName: document.getElementById("fileName"),
  fileSize: document.getElementById("fileSize"),
  cornerMode: document.getElementById("cornerMode")
};

let currentFile = null;
let currentDownloadUrl = "";
let currentPreviewUrl = "";
let currentImageMeta = null;
const THEME_STORAGE_KEY = "theme-preference";
const THEME_COLOR_META = document.querySelector('meta[name="theme-color"]');
const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const shareConfig = {
  title: "Favicon Generator | 在线 ICO 图标生成工具",
  text: "上传 PNG，快速生成多尺寸 favicon.ico，支持圆角开关，纯浏览器本地处理。"
};

initializeTheme();

elements.dropzone.addEventListener("click", () => elements.fileInput.click());
elements.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});

elements.fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) {
    await handleFile(file);
  }
});

elements.roundedToggle.addEventListener("change", async () => {
  updateCornerMode();

  if (currentFile) {
    await updatePreview(currentFile);
  }
});

elements.themeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const preference = button.dataset.themePreference;
    persistThemePreference(preference);
    applyTheme(preference);
  });
});

elements.shareButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const platform = button.dataset.sharePlatform;
    await handleShare(platform);
  });
});

elements.qrCloseButton.addEventListener("click", closeQrModal);
elements.qrBackdrop.addEventListener("click", closeQrModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.qrModal.hidden) {
    closeQrModal();
  }
});

if (typeof systemThemeMedia.addEventListener === "function") {
  systemThemeMedia.addEventListener("change", handleSystemThemeChange);
} else if (typeof systemThemeMedia.addListener === "function") {
  systemThemeMedia.addListener(handleSystemThemeChange);
}

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("is-dragover");
  });
});

elements.dropzone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    await handleFile(file);
  }
});

elements.downloadButton.addEventListener("click", async () => {
  if (!currentFile || !currentImageMeta) {
    return;
  }

  try {
    setStatus("正在生成 ZIP，请稍候...");
    elements.downloadButton.disabled = true;

    const blob = await createZipBlob(currentFile);
    releaseDownloadUrl();
    currentDownloadUrl = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = currentDownloadUrl;
    anchor.download = "favicon-icons.zip";
    anchor.click();

    setStatus("ZIP 生成完成，已开始下载");
  } catch (error) {
    console.error(error);
    setStatus("生成失败，请确认图片为有效 PNG");
  } finally {
    elements.downloadButton.disabled = false;
  }
});

async function handleFile(file) {
  if (!isPngFile(file)) {
    resetState();
    setStatus("仅支持 PNG 文件");
    return;
  }

  try {
    const image = await loadImage(file);
    const meta = {
      width: image.naturalWidth,
      height: image.naturalHeight
    };

    if (!isLargeEnough(meta)) {
      resetState();
      setStatus("图片宽高必须都大于 256 像素");
      return;
    }

    currentFile = file;
    currentImageMeta = meta;
    releaseDownloadUrl();
    updateFileInfo(file, meta);
    await updatePreview(file);
    elements.downloadButton.disabled = false;
    setStatus("PNG 已就绪，可以下载 ZIP 压缩包");
  } catch (error) {
    console.error(error);
    resetState();
    setStatus("图片读取失败，请更换文件后重试");
  }
}

function resetState() {
  currentFile = null;
  currentImageMeta = null;
  releaseDownloadUrl();
  releasePreviewUrl();
  elements.downloadButton.disabled = true;
  elements.previewImage.hidden = true;
  elements.previewImage.removeAttribute("src");
  elements.previewPlaceholder.hidden = false;
  elements.fileName.textContent = "-";
  elements.fileSize.textContent = "-";
  updateCornerMode();
}

function updateFileInfo(file, meta) {
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = `${meta.width} x ${meta.height}`;
  updateCornerMode();
}

async function updatePreview(file) {
  const image = await loadImage(file);
  const previewBlob = await renderPngBlob(image, 256, isRoundedEnabled());

  releasePreviewUrl();
  currentPreviewUrl = URL.createObjectURL(previewBlob);
  elements.previewImage.src = currentPreviewUrl;
  elements.previewImage.hidden = false;
  elements.previewPlaceholder.hidden = true;
}

async function createZipBlob(file) {
  const image = await loadImage(file);
  const rounded = isRoundedEnabled();
  const entries = await Promise.all(
    OUTPUT_SIZES.map(async (size) => {
      const iconImages = await createIconImages(image, [size], rounded);
      const icoBlob = createIcoFile(iconImages);

      return {
        name: getOutputFileName(size),
        data: new Uint8Array(await icoBlob.arrayBuffer())
      };
    })
  );

  return createZipArchive(entries);
}

async function createIcoBlob(file) {
  const image = await loadImage(file);
  const rounded = isRoundedEnabled();
  const iconImages = await createIconImages(image, OUTPUT_SIZES, rounded);

  return createIcoFile(iconImages);
}

async function createIconImages(image, sizes, rounded) {
  return Promise.all(
    sizes.map(async (size) => {
      const pngBlob = await renderPngBlob(image, size, rounded);
      return {
        size,
        data: new Uint8Array(await pngBlob.arrayBuffer())
      };
    })
  );
}

async function renderPngBlob(image, size, rounded) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  drawImageContain(context, image, size, rounded);

  return new Promise((resolve, reject) => {
    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        resolve(pngBlob);
      } else {
        reject(new Error("无法生成 PNG 图片"));
      }
    }, "image/png");
  });
}

function drawImageContain(context, image, size, rounded) {
  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const drawWidth = Math.round(image.naturalWidth * scale);
  const drawHeight = Math.round(image.naturalHeight * scale);
  const offsetX = Math.floor((size - drawWidth) / 2);
  const offsetY = Math.floor((size - drawHeight) / 2);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (rounded) {
    const radius = Math.max(2, Math.round(size * 0.22));
    context.save();
    createRoundedRectPath(context, offsetX, offsetY, drawWidth, drawHeight, radius);
    context.clip();
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
    context.restore();
    return;
  }

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function createRoundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function createIcoFile(images) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = images.length * directoryEntrySize;
  const header = new Uint8Array(headerSize + directorySize);
  const view = new DataView(header.buffer);
  let dataOffset = header.byteLength;

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);

  images.forEach((image, index) => {
    const entryOffset = headerSize + index * directoryEntrySize;
    const dimensionByte = image.size >= 256 ? 0 : image.size;

    view.setUint8(entryOffset, dimensionByte);
    view.setUint8(entryOffset + 1, dimensionByte);
    view.setUint8(entryOffset + 2, 0);
    view.setUint8(entryOffset + 3, 0);
    view.setUint16(entryOffset + 4, 1, true);
    view.setUint16(entryOffset + 6, 32, true);
    view.setUint32(entryOffset + 8, image.data.length, true);
    view.setUint32(entryOffset + 12, dataOffset, true);

    dataOffset += image.data.length;
  });

  return new Blob([header, ...images.map((image) => image.data)], {
    type: "image/x-icon"
  });
}

function createZipArchive(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralDirectorySize = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const crc32 = computeCrc32(entry.data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc32, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, entry.data);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.data.length;
    centralDirectorySize += centralHeader.length;
  });

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endRecord], {
    type: "application/zip"
  });
}

function computeCrc32(bytes) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getOutputFileName(size) {
  if (size === 48) {
    return "favicon.ico";
  }

  return `favicon-${size}x${size}.ico`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const imageUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error("图片加载失败"));
    };

    image.src = imageUrl;
  });
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function isPngFile(file) {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

function isLargeEnough(meta) {
  return meta.width > 256 && meta.height > 256;
}

function isRoundedEnabled() {
  return elements.roundedToggle.checked;
}

function updateCornerMode() {
  elements.cornerMode.textContent = isRoundedEnabled() ? "开启" : "关闭";
}

function releaseDownloadUrl() {
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
    currentDownloadUrl = "";
  }
}

function releasePreviewUrl() {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = "";
  }
}

async function handleShare(platform) {
  if (platform === "copy") {
    await copyCurrentLink();
    return;
  }

  if (platform === "qr") {
    await openQrModal();
    return;
  }

  if (platform === "native") {
    await shareWithNativeDialog();
    return;
  }

  const shareUrl = buildShareUrl(platform);
  if (!shareUrl) {
    setShareStatus("当前分享平台暂不支持。");
    return;
  }

  window.open(shareUrl, "_blank", "noopener,noreferrer");
  setShareStatus(`已打开 ${getPlatformLabel(platform)} 分享窗口`);
}

function buildShareUrl(platform) {
  const pageUrl = encodeURIComponent(window.location.href);
  const title = encodeURIComponent(shareConfig.title);
  const text = encodeURIComponent(shareConfig.text);

  const urls = {
    x: `https://twitter.com/intent/tweet?text=${title}&url=${pageUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`,
    reddit: `https://www.reddit.com/submit?url=${pageUrl}&title=${title}`,
    telegram: `https://t.me/share/url?url=${pageUrl}&text=${title}`,
    whatsapp: `https://api.whatsapp.com/send?text=${text}%20${pageUrl}`
  };

  return urls[platform] || "";
}

async function copyCurrentLink() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus("链接已复制");
      return;
    }

    const input = document.createElement("input");
    input.value = window.location.href;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    setShareStatus("链接已复制");
  } catch (error) {
    console.error(error);
    setShareStatus("复制失败，请手动复制当前链接");
  }
}

async function shareWithNativeDialog() {
  if (!navigator.share) {
    setShareStatus("当前浏览器不支持系统分享，请使用下方社交平台按钮");
    return;
  }

  try {
    await navigator.share({
      title: shareConfig.title,
      text: shareConfig.text,
      url: window.location.href
    });
    setShareStatus("分享面板已打开");
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      setShareStatus("系统分享失败，请尝试其他分享方式");
    }
  }
}

function setShareStatus(message) {
  elements.shareStatus.textContent = message;
}

function getPlatformLabel(platform) {
  const labels = {
    x: "X",
    facebook: "Facebook",
    linkedin: "LinkedIn",
    reddit: "Reddit",
    telegram: "Telegram",
    whatsapp: "WhatsApp"
  };

  return labels[platform] || "社交平台";
}

async function openQrModal() {
  try {
    const qrDataUrl = await QRCode.toDataURL(window.location.href, {
      width: 280,
      margin: 1,
      color: {
        dark: "#172033",
        light: "#FFFFFF"
      }
    });

    elements.qrImage.src = qrDataUrl;
    elements.qrLinkText.textContent = window.location.href;
    elements.qrModal.hidden = false;
    setShareStatus("二维码已生成");
  } catch (error) {
    console.error(error);
    setShareStatus("二维码生成失败，请稍后重试");
  }
}

function closeQrModal() {
  elements.qrModal.hidden = true;
}

function initializeTheme() {
  const preference = getStoredThemePreference();
  applyTheme(preference);
}

function getStoredThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch (error) {
    console.error(error);
  }

  return "auto";
}

function persistThemePreference(preference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch (error) {
    console.error(error);
  }
}

function applyTheme(preference) {
  const resolvedTheme = resolveTheme(preference);

  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolvedTheme;
  updateThemeButtons(preference);

  if (THEME_COLOR_META) {
    THEME_COLOR_META.setAttribute("content", resolvedTheme === "dark" ? "#07111f" : "#3977ff");
  }
}

function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") {
    return preference;
  }

  return systemThemeMedia.matches ? "dark" : "light";
}

function handleSystemThemeChange() {
  if (getStoredThemePreference() === "auto") {
    applyTheme("auto");
  }
}

function updateThemeButtons(preference) {
  elements.themeButtons.forEach((button) => {
    const isActive = button.dataset.themePreference === preference;
    button.setAttribute("aria-pressed", String(isActive));
    button.dataset.active = isActive ? "true" : "false";
  });
}
