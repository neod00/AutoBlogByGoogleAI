import React, { useState, useEffect, useCallback } from 'react';

interface CookieStatus {
  status: 'valid' | 'expired' | 'unknown';
  checkedAt: string;
  error: string;
  lastValidAt: string;
}

interface CookieStatusBadgeProps {
  token: string;
}

const CookieStatusBadge: React.FC<CookieStatusBadgeProps> = ({ token }) => {
  const [data, setData] = useState<CookieStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cookie-status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.cookieStatus);
      }
    } catch (err) {
      console.error('Failed to fetch cookie status:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleRefresh = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    // 60초마다 자동 갱신
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const formatTimeAgo = (isoString: string): string => {
    if (!isoString) return '확인 기록 없음';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  };

  const formatDateTime = (isoString: string): string => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  };

  if (loading) {
    return (
      <div className="animate-pulse bg-slate-200 dark:bg-slate-700 rounded-2xl h-20" />
    );
  }

  const status = data?.status || 'unknown';

  const config = {
    valid: {
      icon: '🟢',
      label: '티스토리 로그인 정상',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-800',
      textColor: 'text-emerald-700 dark:text-emerald-400',
      dotColor: 'bg-emerald-500',
      pulseColor: 'bg-emerald-400',
      gradientFrom: 'from-emerald-500',
      gradientTo: 'to-teal-500',
    },
    expired: {
      icon: '🔴',
      label: '티스토리 로그인 만료됨',
      bg: 'bg-red-50 dark:bg-red-950/40',
      border: 'border-red-200 dark:border-red-800',
      textColor: 'text-red-700 dark:text-red-400',
      dotColor: 'bg-red-500',
      pulseColor: 'bg-red-400',
      gradientFrom: 'from-red-500',
      gradientTo: 'to-orange-500',
    },
    unknown: {
      icon: '⚪',
      label: '상태 미확인',
      bg: 'bg-slate-100 dark:bg-slate-800/60',
      border: 'border-slate-200 dark:border-slate-700',
      textColor: 'text-slate-600 dark:text-slate-400',
      dotColor: 'bg-slate-400',
      pulseColor: 'bg-slate-300',
      gradientFrom: 'from-slate-400',
      gradientTo: 'to-slate-500',
    },
  };

  const c = config[status];

  return (
    <div
      className={`relative overflow-hidden ${c.bg} border ${c.border} rounded-2xl transition-all duration-300 cursor-pointer hover:shadow-lg`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* 상단 그라데이션 바 */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${c.gradientFrom} ${c.gradientTo}`} />

      <div className="p-5 pt-4">
        {/* 메인 상태 row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 상태 아이콘 (펄스 애니메이션) */}
            <div className="relative flex items-center justify-center w-10 h-10">
              <span className={`absolute w-6 h-6 rounded-full ${c.pulseColor} opacity-30 ${status === 'expired' ? 'animate-ping' : ''}`} />
              <span className={`relative w-3.5 h-3.5 rounded-full ${c.dotColor} shadow-sm`} />
            </div>

            <div>
              <h3 className={`text-sm font-bold ${c.textColor}`}>
                {c.label}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                마지막 확인: {formatTimeAgo(data?.checkedAt || '')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 새로고침 버튼 */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="로그인 상태 새로고침"
              className={`p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshing ? 'animate-spin' : ''}
                style={{ animationDuration: '0.8s' }}
              >
                <path d="M21.5 2v6h-6" />
                <path d="M2.5 22v-6h6" />
                <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8" />
                <path d="M22 12.5a10 10 0 0 1-18.8 4.2L2.5 16" />
              </svg>
            </button>

            {/* 토글 화살표 */}
            <div className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>

        {/* 확장 디테일 */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-700/60 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">마지막 확인 시각</span>
              <span className={c.textColor}>{formatDateTime(data?.checkedAt || '')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">마지막 정상 확인</span>
              <span className="text-emerald-600 dark:text-emerald-400">{formatDateTime(data?.lastValidAt || '')}</span>
            </div>
            {data?.error && (
              <div className="mt-2 p-3 bg-red-100/60 dark:bg-red-900/20 rounded-xl">
                <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all">
                  ⚠️ {data.error}
                </p>
              </div>
            )}
            {status === 'expired' && (
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed mb-3">
                  💡 노트북 수동 로그인 대신 자동 쿠키 갱신(핸드폰 앱 승인)을 요청할 수 있습니다.
                </p>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('카카오 자동 로그인을 요청하시겠습니까? (핸드폰 카톡 알림 대기 필수)')) return;
                    
                    try {
                      const res = await fetch('/api/admin/trigger-refresh-cookie', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                      });
                      if (res.ok) alert('요청이 전송되었습니다! 약 30~40초 뒤 폰으로 카카오 알림이 오면 승인해주세요.');
                      else alert('요청에 실패했습니다.');
                    } catch(err) {
                      alert('요청 중 에러가 발생했습니다.');
                    }
                  }}
                  className="w-full py-2 px-3 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-800/60 text-amber-800 dark:text-amber-300 rounded-lg text-xs font-bold transition-colors shadow-sm"
                >
                  🔄 원클릭 자동 갱신 요청
                </button>
              </div>
            )}
            {status === 'unknown' && (
              <div className="mt-3 p-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  ℹ️ 아직 한 번도 발행이 시도되지 않았거나, 상태 보고 기능이 활성화되기 전입니다.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CookieStatusBadge;
