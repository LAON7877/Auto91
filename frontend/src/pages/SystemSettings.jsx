// 繁體中文註釋
import React from 'react'
import { getAdminConfig, updateAdminConfig } from '../services/api'

export default function SystemSettings() {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [enabled, setEnabled] = React.useState(true)
  const [percentStr, setPercentStr] = React.useState('10') // 百分比字串
  const [tgIdsStr, setTgIdsStr] = React.useState('')
  const [tz, setTz] = React.useState('Asia/Taipei')
  const [msg, setMsg] = React.useState('')

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        const cfg = await getAdminConfig()
        const w = cfg?.weekly || {}
        setEnabled(w.enabled !== false)
        setPercentStr(String(Math.round(Number(w.percent || 0.1) * 100)))
        setTgIdsStr(Array.isArray(w.tgIds) ? w.tgIds.join(',') : '')
        setTz(String(w.tz || 'Asia/Taipei'))
      } catch (_) {}
      finally { setLoading(false) }
    })()
  }, [])

  async function onSave() {
    try {
      setSaving(true); setMsg('')
      const p = Number(percentStr)
      if (!Number.isFinite(p) || p < 0 || p > 100) { setMsg('抽傭比例須介於 0~100'); setSaving(false); return }
      const body = {
        weekly: {
          enabled: !!enabled,
          percent: p / 100,
          tgIds: tgIdsStr,
          tz: tz || 'Asia/Taipei'
        }
      }
      await updateAdminConfig(body)
      setMsg('已儲存，即時生效')
    } catch (e) { setMsg('儲存失敗：' + (e?.response?.data?.error || e?.message || '')) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="panel" style={{ marginTop: 12 }}><div className="panel-body">讀取中...</div></div>

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-body">
        <h3 style={{ marginTop: 0 }}>週報設置</h3>
        <div className="grid" style={{ maxWidth: 560 }}>
          <label>週報開關</label>
          <div>
            <label className="toggle-switch">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>

          <label>抽傭比例</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min="0" max="100" value={percentStr} onChange={e => setPercentStr(e.target.value)} style={{ width: 120 }} />
            <span className="unit">%</span>
          </div>

          <label>Telegram 通知</label>
          <div>
            <input type="text" placeholder="例如：12345678,-100987654321（可多個，逗號分限）" value={tgIdsStr} onChange={e => setTgIdsStr(e.target.value)} />
          </div>

          <label>週報時區</label>
          <div>
            <input type="text" placeholder="Asia/Taipei" value={tz} onChange={e => setTz(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn-secondary" onClick={onSave} disabled={saving}>{saving ? '儲存中...' : '儲存'}</button>
          {msg ? <span style={{ marginLeft: 8 }}>{msg}</span> : null}
        </div>
      </div>
    </div>
  )
}


