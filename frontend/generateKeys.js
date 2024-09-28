// keygen.js
const crypto = require('crypto');
const fs = require('fs');

// Generate RSA key pair with public key in SPKI format
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048, // Key size
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs1', // Private key remains in 'pkcs1'
    format: 'pem',
  },
});

// Save keys to files
fs.writeFileSync('public_key.pem', publicKey);
fs.writeFileSync('private_key.pem', privateKey);

// Additionally, create a Base64-encoded version of the public key without PEM headers
const publicKeyBase64 = publicKey
  .replace(/-----BEGIN PUBLIC KEY-----/, '')
  .replace(/-----END PUBLIC KEY-----/, '')
  .replace(/\s/g, '');

// Save the Base64-encoded public key
fs.writeFileSync('public_key_base64.txt', publicKeyBase64);

console.log('RSA Keys generated and saved in SPKI format.');