import React, { useState, useCallback, useEffect } from 'react';
import { generateBlogPost, fetchAndInjectImages } from './services/geminiService';
import BlogPostDisplay from './components/BlogPostDisplay';
import ImageKeywordEditor from './components/ImageKeywordEditor';

type Theme = 'light' | 'dark';
type DateRange = 'all' | 'day' | 'week' | 'month' | 'year';
type Template = 'default' | 'review' | 'interview' | 'qa' | 'investment';
type GenerationPhase = 'idle' | 'generating' | 'awaitingImageConfirmation' | 'fetchingImages' | 'complete';

interface BlogResult {
  title: string;
  post: string;
  tags: string[];
  imageKeywords?: string[];
  originalPost?: string; // 이미지가 없는 원본 포스트
}

interface PendingBlogResult extends BlogResult {
  imageKeywords: string[];
}

const App: React.FC = () => {
  const [keyword, setKeyword] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [template, setTemplate] = useState<Template>('default');
  const [blogResult, setBlogResult] = useState<BlogResult | null>(null);
  const [pendingBlogResult, setPendingBlogResult] = useState<PendingBlogResult | null>(null);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>('idle');
  const [error, setError] = useState<string>('');
  const [theme, setTheme] = useState<Theme>('dark');
  
  const isLoading = generationPhase === 'generating' || generationPhase === 'fetchingImages';

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
  const autoStartRef = React.useRef(false);

  useEffect(() => {
    if (autoStartRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const keywordParam = params.get('keyword');
    const autoParam = params.get('auto');

    console.log('Auto-start check:', { keywordParam, autoParam });

    if (keywordParam && (autoParam === 'true' || autoParam === '1')) {
      autoStartRef.current = true;
      setKeyword(keywordParam);

      (async () => {
        console.log('Starting auto-generation for:', keywordParam);
        setGenerationPhase('generating');
        setError('');
        setBlogResult(null);
        setPendingBlogResult(null);
        try {
          const result = await generateBlogPost(keywordParam, 'all', 'default');
          console.log('Auto-generation result:', result);
          // Store pending result and show image keyword editor
          setPendingBlogResult({
            title: result.title,
            post: result.post,
            tags: result.tags,
            imageKeywords: result.imageKeywords || []
          });
          setGenerationPhase('awaitingImageConfirmation');
        } catch (err) {
          console.error('Auto-generation error:', err);
          const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
          setError(`글 생성에 실패했습니다: ${errorMessage}`);
          setGenerationPhase('idle');
        }
      })();
    }
  }, []);

  const handleGenerateClick = useCallback(async () => {
    if (!keyword.trim()) {
      setError('키워드를 입력해주세요.');
      return;
    }
    setGenerationPhase('generating');
    setError('');
    setBlogResult(null);
    setPendingBlogResult(null);

    try {
      const result = await generateBlogPost(keyword, dateRange, template);
      // Store pending result and show image keyword editor
      setPendingBlogResult({
        title: result.title,
        post: result.post,
        tags: result.tags,
        imageKeywords: result.imageKeywords || []
      });
      setGenerationPhase('awaitingImageConfirmation');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`글 생성에 실패했습니다: ${errorMessage}`);
      console.error(err);
      setGenerationPhase('idle');
    }
  }, [keyword, dateRange, template]);

  const handleImageConfirm = useCallback(async (imageKeywords: string[]) => {
    if (!pendingBlogResult) return;
    
    setGenerationPhase('fetchingImages');
    
    try {
      const { post: postWithImages } = await fetchAndInjectImages(
        pendingBlogResult.post,
        imageKeywords,
        keyword
      );
      
      setBlogResult({
        title: pendingBlogResult.title,
        post: postWithImages,
        tags: pendingBlogResult.tags,
        imageKeywords: imageKeywords,
        originalPost: pendingBlogResult.post // 원본 포스트 저장
      });
      setPendingBlogResult(null);
      setGenerationPhase('complete');
    } catch (err) {
      console.error('Image fetch error:', err);
      // Even if image fetch fails, show the post without images
      setBlogResult({
        title: pendingBlogResult.title,
        post: pendingBlogResult.post,
        tags: pendingBlogResult.tags,
        imageKeywords: imageKeywords,
        originalPost: pendingBlogResult.post
      });
      setPendingBlogResult(null);
      setGenerationPhase('complete');
    }
  }, [pendingBlogResult, keyword]);

  const handleImageSkip = useCallback(() => {
    if (!pendingBlogResult) return;
    
    // Complete without images
    setBlogResult({
      title: pendingBlogResult.title,
      post: pendingBlogResult.post,
      tags: pendingBlogResult.tags,
      imageKeywords: [],
      originalPost: pendingBlogResult.post
    });
    setPendingBlogResult(null);
    setGenerationPhase('complete');
  }, [pendingBlogResult]);

  const handleRegenerateImages = useCallback(() => {
    if (!blogResult) return;
    
    // 이미지 재생성을 위해 pendingBlogResult로 되돌림
    // <figure> 태그와 그 내용을 모두 제거
    const originalPost = blogResult.originalPost || blogResult.post.replace(/<figure[\s\S]*?<\/figure>/gi, '').replace(/\s*\n\s*\n\s*/g, '\n').trim();
    
    setPendingBlogResult({
      title: blogResult.title,
      post: originalPost,
      tags: blogResult.tags,
      imageKeywords: blogResult.imageKeywords || []
    });
    setBlogResult(null);
    setGenerationPhase('awaitingImageConfirmation');
  }, [blogResult]);

  const LoadingSpinner: React.FC<{ phase: GenerationPhase }> = ({ phase }) => (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
      <div className="w-12 h-12 border-4 border-t-transparent border-cyan-500 rounded-full animate-spin"></div>
      {phase === 'generating' ? (
        <>
          <p className="mt-4 text-lg">블로그 글을 생성하고 있습니다...</p>
          <p className="text-sm">Gemini AI가 최신 뉴스를 검색하고 분석하는 데 시간이 걸릴 수 있습니다.</p>
        </>
      ) : (
        <>
          <p className="mt-4 text-lg">이미지를 검색하고 있습니다...</p>
          <p className="text-sm">Pexels에서 관련 이미지를 찾고 있습니다.</p>
        </>
      )}
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
          {generationPhase === 'generating' || generationPhase === 'fetchingImages' ? (
            <LoadingSpinner phase={generationPhase} />
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 p-4 rounded-lg text-center">
                <p className="font-bold mb-2">오류 발생</p>
                <p>{error}</p>
              </div>
            </div>
          ) : generationPhase === 'awaitingImageConfirmation' && pendingBlogResult ? (
            <div className="flex flex-col h-full">
              {/* Preview of generated content */}
              <div className="flex-grow overflow-auto">
                <BlogPostDisplay 
                  title={pendingBlogResult.title} 
                  post={pendingBlogResult.post} 
                  tags={pendingBlogResult.tags} 
                />
              </div>
              {/* Image keyword editor overlay */}
              <div className="shrink-0 p-4 border-t border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
                <ImageKeywordEditor
                  keywords={pendingBlogResult.imageKeywords}
                  onConfirm={handleImageConfirm}
                  onSkip={handleImageSkip}
                  isLoading={false}
                />
              </div>
            </div>
          ) : blogResult ? (
            <BlogPostDisplay 
              title={blogResult.title} 
              post={blogResult.post} 
              tags={blogResult.tags}
              onRegenerateImages={blogResult.imageKeywords && blogResult.imageKeywords.length > 0 ? handleRegenerateImages : undefined}
            />
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