const twitterClientId = 'WHZUSzBwWW5HOTliMDk5ZTdyMG86MTpjaQ'; 
let codeVerifier = '';
let serverPublicKeyHex = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApF+4g49X1JpEcPg4mw0Bx2Jbpg0CaGOBr/+DfiGDhZTPyl9I0XaOOvGGo49ktmQmATpY3sO7YJ2Df+oK52s/pvU5nW9VUAqjuQiiOEm1YlxZKMUa0NT7/WV4PA/x8fATFMWBv5+bCk8Z8vKgoMMqFY2Pq8jmD4onww6ohB7Bg0QHJhPrURecBK3jRmfGOpAOpmCFiDVY3CyLmX1eJjdC2FxGHBcbmaZV2gmRjVDPFsxU+gpmQyRur7ebEJJPeInVodY/FXLy7OyNcaaCL5A5xfLtrQee2sdTWA8cS7JUAKWIxmCYXtWgajm4KAWUo8abqEVrZ2Sc/7+ceE7NB4sMsQIDAQAB`;


// Step 2: Handle the callback after Twitter login
window.onload = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const authorizationCode = urlParams.get('code');

    console.log('authorizationCode', authorizationCode);
    
    const publicKey = await importPublicKey(serverPublicKeyHex);
    const encryptedData = await encryptData(publicKey, authorizationCode);
    console.log('Encrypted Data:', encryptedData);
  };


// Select the first button with the class 'wl-connect-wallet-btn'
const walletButton = document.querySelector('.wl-connect-wallet-btn');

// Check if the button exists and add an event listener
if (walletButton) {
    walletButton.addEventListener('click', async () => {
        // Code to execute when the button is clicked
        console.log('WalletConnect button clicked!');
        // Add your wallet connection logic here

        // Generate the code verifier and challenge for PKCE
        codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // Redirect the user to Twitter for authorization
        const twitterAuthUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${twitterClientId}&redirect_uri=${encodeURIComponent(windows.location.href)}&scope=users.read&state=state123&code_challenge=${codeChallenge}&code_challenge_method=S256`;

        // Redirect to Twitter login
        window.location.href = twitterAuthUrl;
    });
}

// Generate a code verifier for PKCE (random string)
function generateCodeVerifier() {
    const array = new Uint32Array(56 / 2);
    window.crypto.getRandomValues(array);
    return Array.from(array, (dec) => ('0' + dec.toString(16)).substr(-2)).join('');
}

  // Generate a code challenge from the code verifier (SHA-256 hash, base64-url encoded)
async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
}

// Base64-url encode (RFC 4648)
function base64UrlEncode(buffer) {
const bytes = new Uint8Array(buffer);
return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}


// Function to convert a hex string to ArrayBuffer
function hexToArrayBuffer(hex) {
    if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
    const buffer = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      buffer[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return buffer.buffer;
  }

  // Function to convert ArrayBuffer to hex string
  function arrayBufferToHex(buffer) {
    const byteArray = new Uint8Array(buffer);
    return Array.from(byteArray)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function encryptData(publicKey, data) {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);

    // Encrypt the data
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'RSA-OAEP',
      },
      publicKey,
      encodedData
    );

    // Convert encrypted data to Base64
    return bufferToBase64(encrypted);
  }

  async function importPublicKey(publicKeyBase64) {
    const publicKeyArrayBuffer = base64ToArrayBuffer(publicKeyBase64);
    console.log('publicKeyArrayBuffer', publicKeyArrayBuffer);
    return await window.crypto.subtle.importKey(
      'spki',
      publicKeyArrayBuffer,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      false,
      ['encrypt']
    );
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((b) => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }