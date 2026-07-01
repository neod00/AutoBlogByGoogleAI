import React, { useState, useEffect } from 'react';

interface DiscoveredKeyword {
  id: string;
  seed: string;
  mainKeyword: string;
  subKeywords: string[];
  suggestedTitle: string;
  hookSummary: string;
  searchIntent: string;
  difficulty: 'low' | 'medium' | 'high';
  template: string;
  reasoning: string;
  status: 'discovered' | 'approved' | 'dismissed';
  discoveredAt: string;
}

interface KeywordDiscoveryProps {
  token: string;
  onAddToQueue: (title: string, template: string) => void;
}

const DIFFICULTY_STYLES: Record<string, { bg: string; text: string; label: string; dot: string }> = {
  low: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', label: '경쟁 낮음', dot: '🟢' },
  medium: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: '중간', dot: '🟡' },
  high: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: '경쟁 높음', dot: '🔴' },
};

const INTENT_COLORS: Record<string, string> = {
  '정보탐색': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  '비교분석': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  '방법가이드': 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  '트렌드분석': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  '심층해설': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

const TEMPLATE_LABELS: Record<string, string> = {
  default: '뉴스 분석',
  review: '리뷰',
  interview: '인터뷰',
  qa: 'Q&A',
  investment: '투자 분석',
};

const KeywordDiscovery: React.FC<KeywordDiscoveryProps> = ({ token, onAddToQueue }) => {
  const [keywords, setKeywords] = useState<DiscoveredKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [filter, setFilter] = useState<'all' | 'discovered' | 'approved' | 'dismissed'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const fetchKeywords = async () => {
    try {
      const res = await fetch('/api/admin/discover-keywords', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKeywords(data.keywords || []);
      }
    } catch (e) {
      console.error('Fetch keywords error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeywords();
  }, [token]);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setNotice({
      type: 'info',
      message: 'Gemini와 Google Search로 최신 키워드를 발굴 중입니다. 최대 1분 정도 걸릴 수 있습니다.',
    });
    try {
      const res = await fetch('/api/admin/discover-keywords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setKeywords(data.keywords || []);
        const newCount = Number(data.newCount || 0);
        const discoveredCount = Number(data.discoveredCount || 0);
        const selectedSeeds = Array.isArray(data.selectedSeeds) ? data.selectedSeeds.join(', ') : '';

        if (newCount > 0) {
          setNotice({
            type: 'success',
            message: `새 키워드 ${newCount}개를 추가했습니다.${selectedSeeds ? ` 선택 시드: ${selectedSeeds}` : ''}`,
          });
        } else if (discoveredCount > 0) {
          setNotice({
            type: 'info',
            message: `발굴은 완료됐지만 기존 대기열/키워드와 중복되어 새로 추가된 항목이 없습니다.${selectedSeeds ? ` 선택 시드: ${selectedSeeds}` : ''}`,
          });
        } else {
          setNotice({
            type: 'info',
            message: `발굴은 완료됐지만 Gemini가 사용할 만한 신규 키워드를 반환하지 않았습니다.${selectedSeeds ? ` 선택 시드: ${selectedSeeds}` : ''}`,
          });
        }
      } else {
        const errorMessage = data.error || `키워드 발굴에 실패했습니다. HTTP ${res.status} 응답을 받았습니다.`;
        setNotice({ type: 'error', message: errorMessage });
        alert(errorMessage);
      }
    } catch (e) {
      const errorMessage = '네트워크 오류가 발생했습니다. 배포 함수 시간 초과나 연결 문제일 수 있습니다.';
      setNotice({ type: 'error', message: errorMessage });
      alert(errorMessage);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleStatusChange = async (id: string, status: 'discovered' | 'approved' | 'dismissed') => {
    try {
      const res = await fetch('/api/admin/discover-keywords', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        setKeywords(prev => prev.map(k => k.id === id ? { ...k, status } : k));
      }
    } catch (e) {
      console.error('Status change error:', e);
    }
  };

  const handleApproveAndQueue = async (kw: DiscoveredKeyword) => {
    await handleStatusChange(kw.id, 'approved');
    onAddToQueue(kw.suggestedTitle, kw.template);
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/admin/discover-keywords?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      setKeywords(prev => prev.filter(k => k.id !== id));
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const filteredKeywords = filter === 'all' ? keywords : keywords.filter(k => k.status === filter);

  const discoveredCount = keywords.filter(k => k.status === 'discovered').length;
  const approvedCount = keywords.filter(k => k.status === 'approved').length;

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-500 animate-pulse">발굴된 키워드를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            🔍 SEO 키워드 발굴소
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            AI가 분석한 트렌딩 롱테일 키워드 · 
            <span className="text-cyan-500 font-semibold"> {discoveredCount}개 검토 대기</span>
            {approvedCount > 0 && <span className="text-emerald-500 font-semibold"> · {approvedCount}개 승인됨</span>}
          </p>
        </div>
        <button
          onClick={handleDiscover}
          disabled={isDiscovering}
          className="px-5 py-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-violet-500/30 transition transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-wait flex items-center gap-2"
        >
          {isDiscovering ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              AI 발굴 중...
            </>
          ) : (
            <>✨ 지금 발굴하기</>
          )}
        </button>
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          notice.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900/60 dark:text-emerald-300'
            : notice.type === 'error'
            ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900/60 dark:text-red-300'
            : 'bg-cyan-50 border-cyan-200 text-cyan-700 dark:bg-cyan-950/30 dark:border-cyan-900/60 dark:text-cyan-300'
        }`}>
          {notice.message}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-0">
        {([
          { key: 'all', label: '전체', count: keywords.length },
          { key: 'discovered', label: '📥 검토 대기', count: discoveredCount },
          { key: 'approved', label: '✅ 승인됨', count: approvedCount },
          { key: 'dismissed', label: '🚫 기각', count: keywords.filter(k => k.status === 'dismissed').length },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-[1px] ${
              filter === tab.key
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                filter === tab.key 
                  ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400' 
                  : 'bg-slate-100 dark:bg-slate-800'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Keyword Cards */}
      {filteredKeywords.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <div className="text-4xl mb-3">🧭</div>
          <p className="text-slate-500 mb-2">발굴된 키워드가 없습니다</p>
          <p className="text-sm text-slate-400">위의 <strong>"지금 발굴하기"</strong> 버튼이나 매일 크론 작업이 실행되면 여기에 키워드가 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredKeywords.map((kw) => {
            const diff = DIFFICULTY_STYLES[kw.difficulty] || DIFFICULTY_STYLES.medium;
            const intentColor = INTENT_COLORS[kw.searchIntent] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
            const isExpanded = expandedId === kw.id;
            const isNew = kw.status === 'discovered';

            return (
              <div
                key={kw.id}
                className={`relative overflow-hidden bg-white dark:bg-slate-900 border rounded-xl shadow-sm transition-all duration-200 hover:shadow-md ${
                  isNew
                    ? 'border-cyan-300 dark:border-cyan-700 ring-1 ring-cyan-200 dark:ring-cyan-800/50'
                    : kw.status === 'approved'
                    ? 'border-emerald-200 dark:border-emerald-800 opacity-80'
                    : 'border-slate-200 dark:border-slate-700 opacity-50'
                }`}
              >
                {/* Accent bar */}
                {isNew && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-400 to-blue-500"></div>
                )}

                <div className="p-5 pl-6">
                  {/* Top badges row */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400 font-semibold">
                      #{kw.seed}
                    </span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${diff.bg} ${diff.text}`}>
                      {diff.dot} {diff.label}
                    </span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${intentColor}`}>
                      {kw.searchIntent}
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium">
                      📝 {TEMPLATE_LABELS[kw.template] || kw.template}
                    </span>
                    {kw.status === 'approved' && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 font-bold">
                        ✅ 발행 대기열 추가됨
                      </span>
                    )}
                  </div>

                  {/* Title & Main Keyword */}
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-snug mb-1">
                    {kw.suggestedTitle}
                  </h3>
                  <p className="text-sm text-cyan-600 dark:text-cyan-400 font-medium mb-2">
                    🎯 {kw.mainKeyword}
                  </p>

                  {/* Hook */}
                  <p className="text-sm text-slate-600 dark:text-slate-400 italic mb-3">
                    💡 {kw.hookSummary}
                  </p>

                  {/* Expandable detail */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : kw.id)}
                    className="text-xs text-slate-400 hover:text-cyan-500 transition mb-3"
                  >
                    {isExpanded ? '▲ 상세 접기' : '▼ 상세 보기'}
                  </button>

                  {isExpanded && (
                    <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-2 text-sm border border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="font-semibold text-slate-600 dark:text-slate-300">서브 키워드:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {kw.subKeywords.map((sub, i) => (
                            <span key={i} className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs">
                              {sub}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-600 dark:text-slate-300">추천 이유:</span>
                        <p className="text-slate-500 dark:text-slate-400 mt-0.5">{kw.reasoning}</p>
                      </div>
                      <div className="text-xs text-slate-400">
                        발굴 시각: {new Date(kw.discoveredAt).toLocaleString('ko-KR')}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  {kw.status === 'discovered' && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      <button
                        onClick={() => handleApproveAndQueue(kw)}
                        className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-cyan-500/30 transition transform hover:-translate-y-0.5 flex items-center gap-1.5"
                      >
                        🚀 승인 & 발행 큐 추가
                      </button>
                      <button
                        onClick={() => handleStatusChange(kw.id, 'dismissed')}
                        className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                      >
                        기각
                      </button>
                      <button
                        onClick={() => handleDelete(kw.id)}
                        className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-500 text-sm rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition"
                      >
                        삭제
                      </button>
                    </div>
                  )}

                  {kw.status === 'dismissed' && (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => handleStatusChange(kw.id, 'discovered')}
                        className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 text-sm rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                      >
                        ↩ 복원
                      </button>
                      <button
                        onClick={() => handleDelete(kw.id)}
                        className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-400 text-sm rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition"
                      >
                        영구 삭제
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KeywordDiscovery;
