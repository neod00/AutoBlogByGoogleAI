import React, { useState, useCallback, useEffect } from 'react';
import { generateBlogPost } from './services/geminiService';
import BlogPostDisplay from './components/BlogPostDisplay';

type Theme = 'light' | 'dark';
type DateRange = 'all' | 'day' | 'week' | 'month' | 'year';
type Template = 'default' | 'review' | 'interview' | 'qa' | 'investment';

interface BlogResult {
  title: string;
  post: string;
  tags: string[];
}

const App: React.FC = () => {
  const [keyword, setKeyword] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [template, setTemplate] = useState<Template>('default');
  const [blogResult, setBlogResult] = useState<BlogResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  // Auto-start generation if query params exist
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keywordParam = params.get('keyword');
    const autoParam = params.get('auto');

    if (keywordParam && autoParam === 'true') {
      setKeyword(keywordParam);
      // We need to trigger generation, but handleGenerateClick depends on state that might not be updated yet if we just call it.
      // However, since we are setting keyword here, we can pass it directly or use a ref.
      // Better yet, let's just call a function that takes the keyword as an arg, or rely on a separate effect.
      // For simplicity in this existing structure, let's use a timeout to ensure state update or just call the service directly if we refactor.
      // But since handleGenerateClick uses the 'keyword' state, we should wait for it to update.
      // Actually, the cleanest way without major refactor is to call generate with the param directly.

      // Let's modify handleGenerateClick to accept an optional keyword override, 
      // OR just create a separate internal function. 
      // For now, let's use a simple approach: set state and then trigger.
      // But React state updates are async.

      // Let's just call the internal logic directly here.
      (async () => {
        setIsLoading(true);
        setError('');
        setBlogResult(null);
        try {
          const result = await generateBlogPost(keywordParam, 'all', 'default'); // Default settings for auto-gen
          setBlogResult(result);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
          setError(`글 생성에 실패했습니다: ${errorMessage}`);
          console.error(err);
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, []);

  const handleGenerateClick = useCallback(async () => {
    if (!keyword.trim()) {
      setError('키워드를 입력해주세요.');
      return;
    }
    setIsLoading(true);
    setError('');
    setBlogResult(null);

    try {
      const result = await generateBlogPost(keyword, dateRange, template);
      setBlogResult(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`글 생성에 실패했습니다: ${errorMessage}`);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [keyword, dateRange, template]);

  const LoadingSpinner: React.FC = () => (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
      <div className="w-12 h-12 border-4 border-t-transparent border-cyan-500 rounded-full animate-spin"></div>
      <p className="mt-4 text-lg">블로그 글과 이미지를 생성하고 있습니다...</p>
      <p className="text-sm">Gemini AI가 최신 뉴스를 검색하고 이미지를 찾는 데 시간이 걸릴 수 있습니다.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 flex flex-col p-4 md:p-8 transition-colors duration-300">
      <header className="w-full max-w-5xl mx-auto text-center mb-8 relative">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">뉴스 기반 블로그 포스트 생성기</h1>
        <p className="text-lg text-gray-500 dark:text-gray-400 mt-2">Gemini AI를 사용하여 최신 뉴스로 블로그 글 자동 생성</p>
        <button
          onClick={toggleTheme}
          className="absolute top-0 right-0 p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>
      </header>

      <main className="w-full max-w-5xl mx-auto flex flex-col flex-grow">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleGenerateClick()}
            placeholder="블로그 글의 주제가 될 키워드를 입력하세요 (예: AI 반도체)"
            className="flex-grow bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition"
            disabled={isLoading}
          />
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition"
            disabled={isLoading}
            aria-label="뉴스 검색 기간"
          >
            <option value="all">전체 기간</option>
            <option value="day">지난 24시간</option>
            <option value="week">지난 1주</option>
            <option value="month">지난 1개월</option>
            <option value="year">지난 1년</option>
          </select>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as Template)}
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition"
            disabled={isLoading}
            aria-label="블로그 템플릿"
          >
            <option value="default">기본 뉴스 분석</option>
            <option value="review">제품/서비스 리뷰</option>
            <option value="interview">전문가 인터뷰 형식</option>
            <option value="qa">Q&A 형식</option>
            <option value="investment">투자전략 보고서</option>
          </select>
          <button
            onClick={handleGenerateClick}
            disabled={isLoading}
            className="px-8 py-3 bg-cyan-500 text-white font-semibold rounded-lg hover:bg-cyan-600 transition-colors disabled:bg-gray-500 dark:disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center shrink-0"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                생성 중...
              </>
            ) : (
              '블로그 글 생성'
            )}
          </button>
        </div>

        <div className="flex-grow bg-white/50 dark:bg-gray-800/50 rounded-lg shadow-2xl backdrop-blur-sm border border-gray-300 dark:border-gray-700 p-0 min-h-[500px] flex flex-col">
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 p-4 rounded-lg text-center">
                <p className="font-bold mb-2">오류 발생</p>
                <p>{error}</p>
              </div>
            </div>
          ) : blogResult ? (
            <BlogPostDisplay title={blogResult.title} post={blogResult.post} tags={blogResult.tags} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-500">
              <p>키워드를 입력하고 '블로그 글 생성' 버튼을 클릭하여 시작하세요.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;