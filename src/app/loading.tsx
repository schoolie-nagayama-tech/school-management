export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-[#4b5563]">読み込み中...</p>
      </div>
    </div>
  );
}
