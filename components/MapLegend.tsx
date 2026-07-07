export function MapLegend() {
  const items = [
    { color: '#34d399', label: '70–100', desc: 'Sangat Baik' },
    { color: '#86efac', label: '55–69',  desc: 'Baik' },
    { color: '#fbbf24', label: '40–54',  desc: 'Sedang' },
    { color: '#fb923c', label: '25–39',  desc: 'Kurang' },
    { color: '#f87171', label: '0–24',   desc: 'Buruk' },
  ];

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: 16,
      zIndex: 10,
      background: 'rgba(6,12,24,0.88)',
      backdropFilter: 'blur(14px)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
      padding: '11px 14px',
    }}>
      <div style={{
        fontSize: 9.5,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: 9,
        fontFamily: 'var(--font-body)',
      }}>
        Skor Lokasi
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 10, height: 10,
              borderRadius: 3,
              background: item.color,
              boxShadow: `0 0 6px ${item.color}60`,
              flexShrink: 0,
            }} />
            <div style={{ fontSize: 12, fontFamily: 'var(--font-body)' }}>
              <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: 'rgba(255,255,255,0.28)', marginLeft: 5, fontSize: 11 }}>{item.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
