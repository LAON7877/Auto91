// 繁體中文註釋
// 隧道編輯彈窗：允許修改 cert/key/token/urlSuffix/publicBaseUrl

import React, { useState } from 'react'
import { api } from '../services/api'

export default function TunnelEditModal({ tunnel, onClose }) {
  const [name, setName] = useState(tunnel.name || '')
  const [certPem, setCertPem] = useState(tunnel.certPem || '')
  const [keyPem, setKeyPem] = useState(tunnel.keyPem || '')
  const [token, setToken] = useState(tunnel.token || '')
  const [urlSuffix, setUrlSuffix] = useState(tunnel.urlSuffix || '')
  const [publicBaseUrl, setPublicBaseUrl] = useState(tunnel.publicBaseUrl || '')
  const [err, setErr] = useState('')

  async function submit() {
    setErr('')
    try {
      if (!name || !certPem || !keyPem || !token || !urlSuffix) throw new Error('請完整填寫')
      await api.put(`/tunnels/${tunnel._id}`, { name, certPem, keyPem, token, urlSuffix, publicBaseUrl })
      onClose()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="modal">
      <div className="modal-body">
        <h3>編輯隧道</h3>
        {err && <div className="error">{err}</div>}
        <input placeholder="名稱" value={name} onChange={e => setName(e.target.value)} />
        <textarea placeholder="CERT.PEM" value={certPem} onChange={e => setCertPem(e.target.value)} />
        <textarea placeholder="KEY.PEM" value={keyPem} onChange={e => setKeyPem(e.target.value)} />
        <input placeholder="TOKEN" value={token} onChange={e => setToken(e.target.value)} />
        <input placeholder="URL 後綴 (如 mybot)" value={urlSuffix} onChange={e => setUrlSuffix(e.target.value)} />
        <input placeholder="公開 Base URL (可選)" value={publicBaseUrl} onChange={e => setPublicBaseUrl(e.target.value)} />
        <div className="actions">
          <button onClick={submit}>儲存</button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}






















