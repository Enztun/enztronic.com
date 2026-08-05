export const openGraphImageSize = { width: 1200, height: 630 };

export function OpenGraphCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        color: '#0f172a',
        background:
          'radial-gradient(circle at 90% 10%, #dbeafe 0, transparent 34%), linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1260FE',
            color: '#ffffff',
            fontSize: 30,
            fontWeight: 800,
          }}
        >
          E
        </div>
        <div style={{ fontSize: 34, fontWeight: 800 }}>Enztronic</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            maxWidth: 980,
            fontSize: 64,
            lineHeight: 1.08,
            letterSpacing: '-2px',
            fontWeight: 800,
          }}
        >
          We build the digital systems your business runs on.
        </div>
        <div style={{ fontSize: 26, color: '#475569' }}>
          AI Automation · SaaS Development · Business Systems
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22 }}>
        <div style={{ color: '#1260FE', fontWeight: 700 }}>Jakarta, Indonesia</div>
        <div style={{ color: '#64748b' }}>enztronic.com</div>
      </div>
    </div>
  );
}
