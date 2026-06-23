'use client';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif',
      }}
    >
      <div style={{ maxWidth: '400px', width: '100%' }}>
        <h1 style={{ fontSize: '18px', marginBottom: '16px', color: '#1f2937' }}>
          エラーが発生しました
        </h1>
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#991b1b',
            wordBreak: 'break-all',
          }}
        >
          <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            {error.name}: {error.message}
          </p>
          {error.stack && (
            <pre
              style={{
                fontSize: '11px',
                whiteSpace: 'pre-wrap',
                marginTop: '8px',
                color: '#7f1d1d',
              }}
            >
              {error.stack.slice(0, 500)}
            </pre>
          )}
          {error.digest && <p style={{ marginTop: '4px' }}>Digest: {error.digest}</p>}
        </div>
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '12px',
            color: '#166534',
          }}
        >
          <p>UA: {typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}</p>
        </div>
        <button
          onClick={reset}
          style={{
            display: 'block',
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            background: '#059669',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}
