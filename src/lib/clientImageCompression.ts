// lib/clientImageCompression.ts
// Client-side image compression for uploads with detailed logging.

export interface CompressOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number; // 0–1 for JPEG/WebP
    convertLargePngToJpeg: boolean;
    pngToJpegThresholdBytes: number;
    minBytesSaved: number; // if we don't save at least this, keep original
}

const DEFAULT_OPTS: CompressOptions = {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.78,
    convertLargePngToJpeg: true,
    pngToJpegThresholdBytes: 500 * 1024, // 500kb
    minBytesSaved: 16 * 1024, // 16kb
};

function isImage(file: File) {
    return file.type.startsWith("image/");
}

function shouldScaleDown(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number
) {
    return width > maxWidth || height > maxHeight;
}

function getTargetSize(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number
) {
    const ratio = width / height;

    let targetW = width;
    let targetH = height;

    if (width > maxWidth) {
        targetW = maxWidth;
        targetH = Math.round(maxWidth / ratio);
    }
    if (targetH > maxHeight) {
        targetH = maxHeight;
        targetW = Math.round(maxHeight * ratio);
    }

    return { targetW, targetH };
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}

/**
 * Compress an image File for upload. Returns a new File if compression is
 * worthwhile; otherwise returns the original File instance.
 */
export async function compressImageForUpload(
    inputFile: File,
    partialOpts?: Partial<CompressOptions>
): Promise<File> {
    const opts = { ...DEFAULT_OPTS, ...partialOpts };

    if (!isImage(inputFile)) {
        // console.log("[compressImageForUpload] skip: not an image", {
        //     name: inputFile.name,
        //     type: inputFile.type,
        // });
        return inputFile;
    }

    // skip tiny files
    if (inputFile.size < 40 * 1024) {
        // console.log("[compressImageForUpload] skip: file too small to bother", {
        //     name: inputFile.name,
        //     size: inputFile.size,
        // });
        return inputFile;
    }

    // console.log("[compressImageForUpload] start", {
    //     name: inputFile.name,
    //     originalBytes: inputFile.size,
    //     type: inputFile.type,
    // });

    let blobForProcessing: Blob = inputFile;
    let mime = inputFile.type || "image/jpeg";

    const isPng = mime === "image/png";
    if (
        isPng &&
        opts.convertLargePngToJpeg &&
        inputFile.size >= opts.pngToJpegThresholdBytes
    ) {
        // console.log("[compressImageForUpload] converting PNG to JPEG for better compression", {
        //     originalType: mime,
        //     newType: "image/jpeg",
        // });
        mime = "image/jpeg";
    }

    let img: HTMLImageElement;
    try {
        img = await loadImageFromBlob(blobForProcessing);
    } catch (e) {
        console.warn("[compressImageForUpload] failed to load image; skipping compression", e);
        return inputFile;
    }

    const { width, height } = img;
    if (!width || !height) {
        // console.warn("[compressImageForUpload] invalid dimensions; skipping", {
        //     width,
        //     height,
        // });
        return inputFile;
    }

    const needsScale = shouldScaleDown(
        width,
        height,
        opts.maxWidth,
        opts.maxHeight
    );

    const { targetW, targetH } = needsScale
        ? getTargetSize(width, height, opts.maxWidth, opts.maxHeight)
        : { targetW: width, targetH: height };

    // console.log("[compressImageForUpload] dimensions", {
    //     originalWidth: width,
    //     originalHeight: height,
    //     targetWidth: targetW,
    //     targetHeight: targetH,
    //     needsScale,
    //     targetMime: mime,
    // });

    // Always go through canvas if we got here, so we can compress even if not scaling.
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.warn("[compressImageForUpload] no 2d context; skipping");
        return inputFile;
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);

    const quality =
        mime === "image/jpeg" || mime === "image/webp"
            ? opts.quality
            : 1;

    const compressedBlob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(
            (b) => resolve(b),
            mime,
            quality
        )
    );

    if (!compressedBlob) {
        console.warn("[compressImageForUpload] canvas.toBlob returned null; skipping");
        return inputFile;
    }

    const originalBytes = inputFile.size;
    const compressedBytes = compressedBlob.size;
    const ratio = compressedBytes / originalBytes;

    // console.log("[compressImageForUpload] result bytes", {
    //     originalBytes,
    //     compressedBytes,
    //     ratio,
    //     bytesSaved: originalBytes - compressedBytes,
    // });

    // If we didn't meaningfully reduce size, keep original
    if (compressedBytes >= originalBytes - opts.minBytesSaved) {
        // console.log("[compressImageForUpload] skip replacement: savings not big enough", {
        //     minBytesSaved: opts.minBytesSaved,
        // });
        return inputFile;
    }

    // Keep extension consistent with mime
    const originalName = inputFile.name || "upload";
    const dot = originalName.lastIndexOf(".");
    const base = dot > 0 ? originalName.slice(0, dot) : originalName;

    let ext = ".jpg";
    if (mime === "image/webp") ext = ".webp";
    else if (mime === "image/png") ext = ".png";

    const compressedName = `${base}${ext}`;

    const compressedFile = new File([compressedBlob], compressedName, {
        type: mime,
    });

    console.log("[compressImageForUpload] returning compressed file", {
        originalName,
        compressedName,
        originalBytes,
        compressedBytes,
        ratio,
    });

    return compressedFile;
}
