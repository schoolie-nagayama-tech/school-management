export default function Loading() {
  return (
    <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-[#2a2a2a]">読み込み中...</p>
      </div>
    </div>
  );
}
