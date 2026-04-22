import React, { useState, useEffect } from 'react';
import CookieStatusBadge from './CookieStatusBadge';
import KeywordDiscovery from './KeywordDiscovery';

interface Topic {
  id: string;
  title: string;
  template: string;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  createdAt: string;
  source?: string;
  mainKeyword?: string;
}

interface AdminDashboardProps {
  token: string;
}

type TabKey = 'keywords' | 'queue' | 'settings';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  publishing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 animate-pulse',
  published: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
};

const STATUS_LABELS = {
  pending: '발행 대기',
  publishing: '발행 진행중',
  published: '발행 완료',
  failed: '발행 실패'
};

const TAB_CONFIG: { key: TabKey; icon: string; label: string; description: string }[] = [
  { key: 'keywords', icon: '🔍', label: 'SEO 키워드 발굴', description: 'AI가 분석한 롱테일 키워드' },
  { key: 'queue', icon: '📋', label: '발행 대기열', description: '저장된 주제 큐 관리' },
  { key: 'settings', icon: '⚙️', label: '설정', description: '시드 키워드 · 이메일 · 블로그 설정' },
];

const AdminDashboard: React.FC<AdminDashboardProps> = ({ token }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('keywords');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [settings, setSettings] = useState({ recipientEmail: '', dailyTopic: '' });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // New Topic Form
  const [newTitle, setNewTitle] = useState('');
  const [newTemplate, setNewTemplate] = useState('review');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Settings Form
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // AI Seed Recommendation
  const [recommendedSeeds, setRecommendedSeeds] = useState<any[]>([]);
  const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set());
  const [isLoadingSeeds, setIsLoadingSeeds] = useState(false);

  // Edit Topic State
  const [editTopicId, setEditTopicId] = useState<string | null>(null);
  const [editTopicTitle, setEditTopicTitle] = useState('');
  const [editTopicTemplate, setEditTopicTemplate] = useState('review');

  const fetchTopics = async () => {
    setIsRefreshing(true);
    const res = await fetch('/api/admin/topics', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setTopics(data.topics || []);
    }
    setIsRefreshing(false);
  };

  const fetchSettings = async () => {
    const res = await fetch('/api/admin/settings', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings || {});
    }
  };

  useEffect(() => {
    Promise.all([fetchTopics(), fetchSettings()]).finally(() => setLoading(false));
  }, [token]);

  const handleAddTopic = async (e: React.FormEvent, publishImmediately = false) => {
    e.preventDefault();
    if (!newTitle) return;
    setIsSubmitting(true);

    try {
      // 1. Add to Queue
      const addRes = await fetch('/api/admin/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle, template: newTemplate })
      });
      
      const { topic } = await addRes.json();

      // 2. Publish immediately if requested
      if (publishImmediately && topic) {
        handleTriggerPublish(topic.id, topic.title, topic.template);
      } else {
        fetchTopics();
      }
      
      setNewTitle('');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Called from KeywordDiscovery when user approves a keyword
  const handleAddFromKeyword = async (title: string, template: string) => {
    try {
      await fetch('/api/admin/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, template })
      });
      fetchTopics();
    } catch (e) {
      console.error('Add from keyword error:', e);
    }
  };

  const handleDeleteTopic = async (id: string) => {
    if (!window.confirm('이 주제를 목록에서 삭제하시겠습니까?')) return;
    await fetch(`/api/admin/topics?id=${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    fetchTopics();
  };

  const handleResetStatus = async (id: string) => {
    if (!window.confirm('실제로 발행이 진행 중일 수도 있습니다. 상태를 [발행 대기]로 초기화하시겠습니까?')) return;
    try {
      await fetch('/api/admin/topics', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, status: 'pending' })
      });
      fetchTopics();
    } catch (err) {
      alert("상태 초기화에 실패했습니다.");
    }
  };

  const handleEditStart = (topic: Topic) => {
    setEditTopicId(topic.id);
    setEditTopicTitle(topic.title);
    setEditTopicTemplate(topic.template);
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await fetch('/api/admin/topics', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, title: editTopicTitle, template: editTopicTemplate })
      });
      setEditTopicId(null);
      fetchTopics();
    } catch (err) {
      alert("수정 저장에 실패했습니다.");
    }
  };

  const handleTriggerPublish = async (id: string, title: string, template: string) => {
    if (!window.confirm(`'${title}' 문서를 즉시 자동 발행하시겠습니까?`)) return;
    
    // Optimistic UI update
    setTopics(prev => prev.map(t => t.id === id ? { ...t, status: 'publishing' } : t));

    try {
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, topic: title, template })
      });
      
      if (!res.ok) {
        alert("발행 트리거 실패. 서버 로그를 확인하세요.");
        // Revert status
        setTopics(prev => prev.map(t => t.id === id ? { ...t, status: 'pending' } : t));
      }
    } catch (err) {
      alert("발행 실패. 네트워크 오류.");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(settings)
    });
    setIsSavingSettings(false);
    alert('설정이 저장되었습니다.');
  };

  const handleRecommendSeeds = async () => {
    setIsLoadingSeeds(true);
    setRecommendedSeeds([]);
    setSelectedSeeds(new Set());
    try {
      const res = await fetch('/api/admin/recommend-seeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentSeeds: settings.dailyTopic || '' })
      });
      if (!res.ok) throw new Error('추천 실패');
      const data = await res.json();
      setRecommendedSeeds(data.recommendations || []);
    } catch (e: any) {
      alert('시드 추천에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsLoadingSeeds(false);
    }
  };

  const toggleSeedSelection = (keyword: string) => {
    setSelectedSeeds(prev => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  };

  const handleAddSelectedSeeds = () => {
    if (selectedSeeds.size === 0) return;
    const currentSeeds = (settings.dailyTopic || '').split(',').map(s => s.trim()).filter(Boolean);
    const newSeeds = [...selectedSeeds].filter(s => !currentSeeds.includes(s));
    const merged = [...currentSeeds, ...newSeeds].join(', ');
    setSettings({ ...settings, dailyTopic: merged });
    setRecommendedSeeds([]);
    setSelectedSeeds(new Set());
    alert(`${newSeeds.length}개의 시드가 추가되었습니다. '설정 저장하기'를 눌러 저장하세요.`);
  };

  if (loading) {
    return <div className="text-center py-20 animate-pulse text-slate-500">데이터를 불러오는 중입니다...</div>;
  }

  return (
    <div className="space-y-6">

      {/* Cookie Status */}
      <CookieStatusBadge token={token} />

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl">
        {TAB_CONFIG.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">

        {/* ═══════ TAB: SEO 키워드 발굴 ═══════ */}
        {activeTab === 'keywords' && (
          <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-6 rounded-2xl shadow-xl">
            <KeywordDiscovery token={token} onAddToQueue={handleAddFromKeyword} />
          </div>
        )}

        {/* ═══════ TAB: 발행 대기열 ═══════ */}
        {activeTab === 'queue' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Quick Add */}
            <div className="lg:col-span-1">
              <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-6 rounded-2xl shadow-xl">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  ✨ 새로운 주제 추가
                </h2>
                <form className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 opacity-80">발행할 키워드 또는 기사 제목</label>
                    <textarea
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none resize-none h-24"
                      placeholder="예: 미국 연준 금리 인하 기대감 확산"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 opacity-80">블로그 템플릿</label>
                    <select
                      value={newTemplate}
                      onChange={e => setNewTemplate(e.target.value)}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                    >
                      <option value="default">기본 뉴스 분석</option>
                      <option value="review">제품/서비스 리뷰</option>
                      <option value="interview">전문가 인터뷰</option>
                      <option value="qa">Q&A 형식</option>
                      <option value="investment">투자 전략 분석</option>
                    </select>
                  </div>
                  
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={e => handleAddTopic(e, false)}
                      disabled={!newTitle || isSubmitting}
                      className="flex-1 py-3 px-4 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-medium rounded-xl hover:bg-slate-300 dark:hover:bg-slate-600 transition"
                    >
                      리스트에 추가
                    </button>
                    <button
                      type="button"
                      onClick={e => handleAddTopic(e, true)}
                      disabled={!newTitle || isSubmitting}
                      className="flex-1 py-3 px-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-xl shadow-lg hover:shadow-cyan-500/30 transition transform hover:-translate-y-0.5"
                    >
                      🚀 즉시 발행
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Right: Topic Queue */}
            <div className="lg:col-span-2">
              <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-6 rounded-2xl shadow-xl min-h-full">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    📋 발행 대기열 (Queue)
                  </h2>
                  <button onClick={fetchTopics} disabled={isRefreshing} className="text-sm px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition disabled:opacity-50 flex items-center gap-1">
                    <span className={isRefreshing ? 'animate-spin inline-block' : ''}>🔄</span>
                    {isRefreshing ? '새로고침 중...' : '새로고침'}
                  </button>
                </div>

                {topics.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 bg-slate-100/50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                    대기 중인 주제가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[...topics].reverse().map(topic => (
                      <div key={topic.id} className="group flex flex-col md:flex-row gap-4 justify-between items-start md:items-center p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:border-cyan-500 transition-colors">
                        
                        {editTopicId === topic.id ? (
                          <div className="flex-1 w-full space-y-3">
                            <input 
                              type="text" 
                              value={editTopicTitle} 
                              onChange={(e) => setEditTopicTitle(e.target.value)} 
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none"
                            />
                            <div className="flex gap-2">
                              <select 
                                value={editTopicTemplate} 
                                onChange={(e) => setEditTopicTemplate(e.target.value)}
                                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg outline-none"
                              >
                                <option value="default">기본 뉴스 분석</option>
                                <option value="review">제품/서비스 리뷰</option>
                                <option value="interview">전문가 인터뷰</option>
                                <option value="qa">Q&A 형식</option>
                                <option value="investment">투자 전략 분석</option>
                              </select>
                              <button 
                                onClick={() => handleSaveEdit(topic.id)}
                                className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition"
                              >
                                저장
                              </button>
                              <button 
                                onClick={() => setEditTopicId(null)}
                                className="px-4 py-2 text-slate-500 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${STATUS_COLORS[topic.status]}`}>
                                  {STATUS_LABELS[topic.status]}
                                </span>
                                {topic.source === 'cron-seo' && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 font-semibold">
                                    🤖 AI 발굴
                                  </span>
                                )}
                                <span className="text-xs text-slate-400">
                                  {new Date(topic.createdAt).toLocaleString('ko-KR')}
                                </span>
                              </div>
                              <h3 className="font-medium text-lg truncate" title={topic.title}>{topic.title}</h3>
                              <p className="text-sm text-slate-500">템플릿: {topic.template}</p>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-2 shrink-0 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                              {topic.status === 'publishing' || topic.status === 'failed' ? (
                                <>
                                  <button 
                                    onClick={() => handleResetStatus(topic.id)}
                                    className="px-3 py-1.5 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                                  >
                                    취소 및 초기화
                                  </button>
                                  <button 
                                    onClick={() => handleTriggerPublish(topic.id, topic.title, topic.template)}
                                    className="px-3 py-1.5 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 rounded-lg font-medium hover:bg-cyan-200 dark:hover:bg-cyan-800/50 transition flex items-center gap-1"
                                  >
                                    ▶ 재발행
                                  </button>
                                  {topic.status === 'failed' && (
                                    <button 
                                      onClick={() => handleDeleteTopic(topic.id)}
                                      className="px-3 py-1.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-800/50 transition"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  <button 
                                    onClick={() => handleTriggerPublish(topic.id, topic.title, topic.template)}
                                    className="px-3 py-1.5 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 rounded-lg font-medium hover:bg-cyan-200 dark:hover:bg-cyan-800/50 transition flex items-center gap-1"
                                  >
                                    ▶ 발행
                                  </button>
                                  <button 
                                    onClick={() => handleEditStart(topic)}
                                    className="px-3 py-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800/50 transition"
                                  >
                                    수정
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteTopic(topic.id)}
                                    className="px-3 py-1.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-800/50 transition"
                                  >
                                    삭제
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════ TAB: 설정 ═══════ */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-8 rounded-2xl shadow-xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                ⚙️ 전역 설정 관리
              </h2>
              <form onSubmit={handleSaveSettings} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">결과 알림 수신 이메일</label>
                  <p className="text-xs text-slate-400 mb-2">쉼표로 여러 개 입력 가능</p>
                  <input
                    type="text"
                    value={settings.recipientEmail || ''}
                    onChange={e => setSettings({...settings, recipientEmail: e.target.value})}
                    placeholder="예: admin@example.com, dev@example.com"
                    className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">🔍 SEO 시드 키워드 (핵심 설정)</label>
                  <p className="text-xs text-slate-400 mb-2">
                    쉼표로 여러 개 입력 · 이 키워드를 기반으로 AI가 매일 트렌딩 롱테일 키워드를 발굴합니다
                  </p>
                  <input
                    type="text"
                    value={settings.dailyTopic || ''}
                    onChange={e => setSettings({...settings, dailyTopic: e.target.value})}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                    placeholder="예: 미국주식, AI, 부동산, 반도체"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(settings.dailyTopic || '').split(',').filter(s => s.trim()).map((seed, i) => (
                      <span key={i} className="px-3 py-1 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 rounded-full text-xs font-semibold">
                        #{seed.trim()}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleRecommendSeeds}
                    disabled={isLoadingSeeds}
                    className="mt-3 w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium rounded-xl hover:shadow-lg hover:scale-[1.01] transition-all disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2"
                  >
                    {isLoadingSeeds ? (
                      <><span className="animate-spin">⏳</span> AI가 트렌드를 분석 중...</>
                    ) : (
                      <>🤖 AI 시드 추천받기</>
                    )}
                  </button>

                  {recommendedSeeds.length > 0 && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-purple-600 dark:text-purple-400">🎯 AI 추천 시드 키워드</h4>
                        <span className="text-xs text-slate-400">{selectedSeeds.size}개 선택됨</span>
                      </div>
                      <div className="grid gap-2 max-h-80 overflow-y-auto pr-1">
                        {recommendedSeeds.map((rec: any, i: number) => (
                          <label
                            key={i}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                              selectedSeeds.has(rec.keyword)
                                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 shadow-sm'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-purple-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSeeds.has(rec.keyword)}
                              onChange={() => toggleSeedSelection(rec.keyword)}
                              className="mt-0.5 accent-purple-600 w-4 h-4"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm">{rec.keyword}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                  rec.trend === '급상승' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : rec.trend === '꾸준히높음' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                }`}>{rec.trend}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{rec.category}</span>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{rec.reason}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={handleAddSelectedSeeds}
                        disabled={selectedSeeds.size === 0}
                        className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium rounded-xl hover:shadow-lg transition disabled:opacity-40"
                      >
                        ✅ 선택한 {selectedSeeds.size}개 시드 추가하기
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="w-full py-3 px-4 bg-gradient-to-r from-slate-800 to-slate-600 dark:from-slate-600 dark:to-slate-500 text-white font-medium rounded-xl hover:shadow-lg transition"
                >
                  {isSavingSettings ? '저장 중...' : '💾 설정 저장하기'}
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminDashboard;
