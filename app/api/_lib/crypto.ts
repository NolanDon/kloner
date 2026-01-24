import crypto from "crypto";

function getKey(): Buffer {
    const raw = process.env.KLONER_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error(
            "Missing KLONER_ENCRYPTION_KEY. Set a 32-byte base64 key for encrypting OAuth tokens and secrets."
        );
    }

    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error(
            `Invalid KLONER_ENCRYPTION_KEY length: expected 32 bytes, got ${key.length}. Provide base64-encoded 32 bytes.`
        );
    }

    return key;
}

export type EncryptedBlobV1 = {
    v: 1;
    alg: "aes-256-gcm";
    iv: string; // base64
    tag: string; // base64
    data: string; // base64
};

export function encryptString(plaintext: string): EncryptedBlobV1 {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        v: 1,
        alg: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        data: ciphertext.toString("base64"),
    };
}

export function decryptString(blob: EncryptedBlobV1): string {
    if (!blob || blob.v !== 1 || blob.alg !== "aes-256-gcm") {
        throw new Error("Unsupported encrypted blob format");
    }

    const key = getKey();
    const iv = Buffer.from(blob.iv, "base64");
    const tag = Buffer.from(blob.tag, "base64");
    const data = Buffer.from(blob.data, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString("utf8");
}
