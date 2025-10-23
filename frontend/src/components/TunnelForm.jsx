// 繁體中文註釋
// 通道新增表單

import React, { useState } from 'react'
import { api } from '../services/api'

export default function TunnelForm({ onClose }) {
  const [name, setName] = useState('')
  const [certPem, setCertPem] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [token, setToken] = useState('')
  const [urlSuffix, setUrlSuffix] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [err, setErr] = useState('')

  async function submit() {
    setErr('')
    try {
      if (!name || !certPem || !keyPem || !token || !urlSuffix) throw new Error('請完整填寫')
      await api.post('/tunnels', { name, certPem, keyPem, token, urlSuffix, publicBaseUrl })
      onClose()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="modal">
      <div className="modal-body">
        <h3>新增通道</h3>
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



