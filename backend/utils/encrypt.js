// 繁體中文註釋
// 可逆加解密：AES-256-GCM，用於安全儲存 API Key/Secret

const crypto = require('crypto');

function getKey() {
  const keyBase64 = process.env.ENCRYPTION_KEY;
  if (!keyBase64) throw new Error('缺少 ENCRYPTION_KEY，請在 .env 設定 32 bytes base64 金鑰');
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY 必須為 32 bytes base64');
  return key;
}

function encryptString(plainText) {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptString(encoded) {
  if (!encoded) return '';
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

module.exports = { encryptString, decryptString };























