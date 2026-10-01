export {};

// Makes a new signing key pair. The public key goes in the storm site's settings
// (it decides which repos to trust); the private key becomes the
// STORM_SIGNING_KEY secret on GitHub and is never committed.

const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
const privateKey = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));

const file = process.argv[2] ?? "signing-key.pkcs8.b64";
await Bun.write(file, privateKey);
console.log(`public key: ${publicKey}`);
console.log(`private key written to ${file} — store it as the STORM_SIGNING_KEY secret, then delete the file`);
