const crypto = require('crypto')

const privateKey = process.env.TWITTER_OAUTH_ENCODING_SECRET_KEY;

const encryptedData = `eMuL1l6Kxz4Ez5fUgw2cDTz1yX0ptf17KHxGQXHsz5IurWRItJpg/dE4HBKbEvaeTa0isCAxnBsUf4zYHZMbjXZj8RbmPcQqXTurl8ax0KIgEXXtUBbQKF2jG7dZUpoSlZ6Boy6OnFwzmD5cFl7aHAXisA2dL5hxr+KhG8rNHXGEvyfag6CQbmM0DiPaUAOKvBi+rEFSO7ElCg5gbagszgaELlJNYE9kYGCIDxKCUrOGcjuusEP4BXy5WZ887IOlV6JQXggPuYsQIa5x2jCVMErZcY+l24HmI/robjUXWiQBLx4CsTBeqoFUBm/jrXzLZceRBhHkllallgffSga1aw==`;

const buffer = Buffer.from(encryptedData, 'base64');

    // Decrypt using private key with RSA-OAEP and SHA-256
    const decrypted = crypto.privateDecrypt(
      {
        key: Buffer.from(privateKey, 'base64'),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer
    );

    const decryptedText = decrypted.toString('utf8');

    console.log('decryptedText', decryptedText);