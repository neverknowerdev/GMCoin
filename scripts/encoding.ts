import sodium from 'libsodium-wrappers';

// Encrypt a message using XChaCha20-Poly1305
async function encryptMessage(secretKeyStr: string, message: string): Promise<string> {  
  await sodium.ready;
  const secretKey: Uint8Array = sodium.from_string(secretKeyStr);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES); // 24 bytes nonce
  const cipherText = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
    sodium.from_string(message),
    null, // Additional data (not used)
    null, // No additional data used for auth
    nonce,
    secretKey
  );

  // Concatenate nonce and ciphertext for transmission and convert to Base64
  const combined = new Uint8Array(nonce.length + cipherText.length);
  combined.set(nonce);
  combined.set(cipherText, nonce.length);

  return sodium.to_base64(combined);
}

// Decrypt a message using XChaCha20-Poly1305
async function decryptMessage(secretKeyStr: string, cipherTextBase64: string): Promise<string> {
  await sodium.ready;
  const secretKey: Uint8Array = sodium.from_string(secretKeyStr);
  // Convert from Base64 and extract nonce + ciphertext
  const combined = sodium.from_base64(cipherTextBase64);
  const nonce = combined.slice(0, sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES);
  const cipherText = combined.slice(sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES);

  // Decrypt
  const decrypted = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
    null, // No additional data used for auth
    cipherText,
    null,
    nonce,
    secretKey
  );

  return sodium.to_string(decrypted);
}

// Example usage
(async () => {
  await sodium.ready;
  const secretKey = process.env.TWITTER_USERNAME_ENCODING_KEY as string;

  const message = "1796129942104657921";
  console.log("Original Message:", message);

  // Encrypt the message
  const encrypted = await encryptMessage(secretKey, message);
  console.log("Encrypted Message:", encrypted);
  console.log(encrypted.length);

  // Decrypt the message
  const decrypted = await decryptMessage(secretKey, encrypted);
  console.log("Decrypted Message:", decrypted);
})();