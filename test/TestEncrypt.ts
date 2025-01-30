import {randomBytes} from "@noble/ciphers/webcrypto";
import {gcm} from "@noble/ciphers/aes";
import {bytesToHex, hexToBytes} from "@noble/ciphers/utils";
import {expect} from "chai";

describe("Encryption", function () {
    it('access_token encrypt/decrypt random', function () {
        const secretKey = '1d301612428be037c255ea8b4d1f1b3951f7cb227fcdb318d6b02c84c6bca0a4';

        const accessKey = bytesToHex(randomBytes(20));
        const encryptedAccessKey = encryptData(accessKey, secretKey);

        const decryptedAccessKey = decryptData(encryptedAccessKey, secretKey);

        expect(decryptedAccessKey).to.be.equal(accessKey);
    });

    it('access_token encrypt/decrypt etalon', function () {
        const secretKey = '1d301612428be037c255ea8b4d1f1b3951f7cb227fcdb318d6b02c84c6bca0a4';

        const accessToken = "SFJBUTV3aGstZXZLbENDbWtLbnExcmxoeFRraVM0ejQta2Y2Wi1hYXJkeXA1OjE3Mzc0MDgxNjY5NzY6MTowOmF0OjE";
        const encryptedAccessKey = encryptData(accessToken, secretKey);

        const decryptedAccessKey = decryptData(encryptedAccessKey, secretKey);

        expect(decryptedAccessKey).to.be.equal(accessToken);
    });
});

function encryptData(data: string, key: string): string {
    const dataHex = Buffer.from(data, "utf8").toString("hex");
    const nonce = randomBytes(24);
    const aes = gcm(hexToBytes(key), nonce);
    const ciphertext = aes.encrypt(hexToBytes(dataHex));
    return bytesToHex(nonce) + bytesToHex(ciphertext);
}

function decryptData(encryptedData: string, decryptionKey: string): string {
    const nonce = hexToBytes(encryptedData.slice(0, 48));
    const data = hexToBytes(encryptedData.slice(48));
    const aes = gcm(hexToBytes(decryptionKey), nonce);
    const data_ = aes.decrypt(data);
    return Buffer.from(bytesToHex(data_), "hex").toString("utf8");
}