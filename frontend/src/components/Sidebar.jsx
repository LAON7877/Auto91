// 繁體中文註釋
// 左側邊欄：通道清單 + 使用者清單 + 簡要交易清單

import React, { useEffect, useState } from 'react'
import TunnelForm from './TunnelForm'
import UserForm from './UserForm'
import TunnelEditModal from './TunnelEditModal'
import UserEditModal from './UserEditModal'
import { api } from '../services/api'
import copy from 'clipboard-copy'
import { wsConnect } from '../services/ws'

export default function Sidebar({ onSelectUser, onSelectOverview, onSelectSettings }) {
  const [tunnels, setTunnels] = useState([])
  const [users, setUsers] = useState([])
  const [showTunnelForm, setShowTunnelForm] = useState(false)
  const [showUserForm, setShowUserForm] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [editTunnel, setEditTunnel] = useState(null)
  const [expandTunnel, setExpandTunnel] = useState(false)
  const [expandUser, setExpandUser] = useState(false)
  const isFull = expandTunnel || expandUser

  async function refresh() {
    const [tRes, uRes] = await Promise.all([
      api.get('/tunnels', { headers: { 'Cache-Control': 'no-cache' } }),
      api.get('/users', { headers: { 'Cache-Control': 'no-cache' } })
    ])
    setTunnels(tRes.data)
    setUsers(uRes.data)
  }

  useEffect(() => { refresh() }, [])
  // 監聽 tunnel 刪除廣播：即時刷新清單，避免殘留
  useEffect(() => {
    const ws = wsConnect((ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg && msg.type === 'tunnel_removed') {
          refresh()
        }
      } catch (_) {}
    })
    return () => { try { ws && ws.closeSafely ? ws.closeSafely() : ws.close() } catch (_) {} }
  }, [])

  const signalApiKey = import.meta.env?.VITE_SIGNAL_API_KEY || import.meta.env?.VITE_SIGNAL_API_KEYS || ''
  const buildFullUrl = (t) => (t.publicBaseUrl ? t.fullUrl : (window.location.origin + t.fullUrl))
  const buildFullUrlWithKey = (t) => {
    const base = buildFullUrl(t)
    if (!signalApiKey) return base
    return base + (base.includes('?') ? '&' : '?') + `apiKey=${encodeURIComponent(signalApiKey)}`
  }

  const appendAckFast = (url) => url + (url.includes('?') ? '&' : '?') + 'ack=fast'

  const IconTunnel = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 12h6m6 0h6M9 12a3 3 0 116 0 3 3 0 01-6 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  const IconUser = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" stroke="currentColor" strokeWidth="2"/>
      <path d="M3 22c0-3.866 5.373-7 9-7s9 3.134 9 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
  const IconDashboard = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2"/>
      <rect x="13" y="3" width="8" height="5" rx="2" stroke="currentColor" strokeWidth="2"/>
      <rect x="13" y="10" width="8" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
      <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2"/>
    </svg>
  )

  function TunnelPreviewList() {
    return (
      <ul className="midOnly">
        {tunnels.map(t => (
          <li key={t._id}>
            <div className="row">
              <div>
                <div className="title">{t.name}</div>
              </div>
              <div className="copy-inline" style={{ display: 'flex', alignItems: 'center' }}>
                {t.fullUrl && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-secondary" onClick={() => copy(appendAckFast(buildFullUrl(t)))}>複製</button>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  function TunnelFullList() {
    if (!expandTunnel) return null
    return (
      <ul className="fullOnly">
        {tunnels.map(t => (
          <li key={t._id}>
            <div className="row">
              <div>
                <div className="title">{t.name}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {t.fullUrl && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-secondary" onClick={() => copy(appendAckFast(buildFullUrl(t)))}>複製</button>
                    {signalApiKey ? (
                      <button className="btn-secondary" title="包含 apiKey 參數（來自前端環境變數）" onClick={() => copy(appendAckFast(buildFullUrlWithKey(t)))}>複製</button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            <div className="sub">
              {t.fullUrl ? buildFullUrl(t) : '(儲存後顯示完整 URL)'}
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setEditTunnel(t)}>編輯</button>
              <button className="btn-danger" onClick={async () => { if (confirm('確定刪除隧道？')) { await api.delete(`/tunnels/${t._id}`); refresh() } }}>刪除</button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  function UserPreviewList() {
    return (
      <ul className="midOnly">
        {users.map(u => (
          <li key={u._id} onClick={() => onSelectUser && onSelectUser(u._id)} style={{ cursor: 'pointer' }}>
            <div className="title">{u.name || u.uid} ｜ {u.exchange.toUpperCase()}</div>
          </li>
        ))}
      </ul>
    )
  }

  function UserFullList() {
    if (!expandUser) return null
    return (
      <ul className="fullOnly">
        {users.map(u => (
          <li key={u._id}>
            <div className="title">{u.name || u.uid} ｜ {u.exchange.toUpperCase()}</div>
            <div className="sub">
              {u.uid} ｜ {(u.pair || '').replace('/','')} ｜ {(u.marginMode === 'cross' ? '全倉' : '逐倉')} ｜ {u.leverage}x ｜ {u.riskPercent}% ｜ {(() => {
                const exp = u.subscriptionEnd ? new Date(u.subscriptionEnd) : null
                const expired = exp ? exp.getTime() < Date.now() : false
                const subText = exp ? `${exp.toLocaleDateString()}${expired ? ' (已到期)' : ''}` : '永久'
                return subText
              })()}
            </div>
            {u.selectedTunnel?.name ? (
              <div className="sub" style={{ marginTop: 2 }}>
                {u.selectedTunnel.name}
              </div>
            ) : null}
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setEditUser(u)}>編輯</button>
              <button className="btn-danger" onClick={async () => { if (confirm('確定刪除？')) { await api.delete(`/users/${u._id}`); refresh() } }}>刪除</button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={`sidebar${isFull ? ' full' : ''} ${expandTunnel ? ' full-tunnel' : ''} ${expandUser ? ' full-user' : ''}`}>
      <div className="section">
        <div className="section-header">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <IconDashboard />
            <h3 style={{ margin: 0 }}>儀表板</h3>
          </div>
        </div>
        <div className="collapsed-names midOnly" title="儀表板">
          <div className="collapsed-item" onClick={() => onSelectOverview && onSelectOverview()} style={{ cursor: 'pointer' }}>用戶總覽</div>
          <div className="collapsed-item" onClick={() => onSelectSettings && onSelectSettings()} style={{ cursor: 'pointer' }}>週報設置</div>
        </div>
        
      </div>
      <div className="section section-tunnel">
        <div className="section-header">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="midOnly chev">
              <button className="toggle-btn" onClick={() => { setExpandTunnel(true) }} title="展開">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </span>
            <span className="fullOnly chev">
              <button className="toggle-btn" onClick={() => setExpandTunnel(false)} title="收起">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </span>
            <IconTunnel />
            <h3 style={{ margin: 0 }}>通道</h3>
          </div>
          <button onClick={() => setShowTunnelForm(true)}>新增</button>
        </div>
        {TunnelPreviewList()}
        {TunnelFullList()}
      </div>

      <div className="section section-user">
        <div className="section-header">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="midOnly chev">
              <button className="toggle-btn" onClick={() => { setExpandUser(true) }} title="展開">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </span>
            <span className="fullOnly chev">
              <button className="toggle-btn" onClick={() => setExpandUser(false)} title="收起">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </span>
            <IconUser />
            <h3 style={{ margin: 0 }}>用戶</h3>
          </div>
          <button onClick={() => setShowUserForm(true)}>新增</button>
        </div>
        {UserPreviewList()}
        {UserFullList()}
      </div>

      {showTunnelForm && <TunnelForm onClose={() => { setShowTunnelForm(false); refresh() }} />}
      {showUserForm && <UserForm tunnels={tunnels} onClose={() => { setShowUserForm(false); refresh() }} />}
      {editUser && <UserEditModal tunnels={tunnels} user={editUser} onClose={() => { setEditUser(null); refresh() }} />}
      {editTunnel && <TunnelEditModal tunnel={editTunnel} onClose={() => { setEditTunnel(null); refresh() }} />}
    </div>
  )
}


