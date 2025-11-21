import React, { useState } from 'react';

interface BlogPostDisplayProps {
  title: string;
  post: string;
  tags: string[];
}

interface StyleButtonProps {
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
}

const StyleButton: React.FC<StyleButtonProps> = ({ onClick, isActive, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
      isActive
        ? 'bg-cyan-500 text-white'
        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
    }`}
  >
    {children}
  </button>
);


const BlogPostDisplay: React.FC<BlogPostDisplayProps> = ({ title, post, tags }) => {
  const [copyStatus, setCopyStatus] = useState({
    body: '블로그용 복사',
    full: '전체 파일로 복사',
    tags: '태그 복사'
  });
  
  const [fontSize, setFontSize] = useState<'base' | 'sm' | 'lg'>('base');
  const [lineHeight, setLineHeight] = useState<'relaxed' | 'normal' | 'loose'>('relaxed');

  const fontSizeClassMap = { sm: 'text-sm', base: 'text-base', lg: 'text-lg' };
  const lineHeightClassMap = { normal: 'leading-normal', relaxed: 'leading-relaxed', loose: 'leading-loose' };


  const handleCopyBodyOnly = () => {
    const contentToCopy = `<h1>${title}</h1>\n${post}`;
    navigator.clipboard.writeText(contentToCopy).then(() => {
      setCopyStatus(prev => ({ ...prev, body: '복사 완료!' }));
      setTimeout(() => {
        setCopyStatus(prev => ({ ...prev, body: '블로그용 복사' }));
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy body: ', err);
      setCopyStatus(prev => ({ ...prev, body: '복사 실패' }));
       setTimeout(() => {
        setCopyStatus(prev => ({ ...prev, body: '블로그용 복사' }));
      }, 2000);
    });
  };
  
  const handleCopyFullFile = () => {
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="ko">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${title}</title>
          <style>
              body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                  line-height: 1.7;
                  color: #333;
                  background-color: #ffffff;
                  margin: 0;
                  padding: 2rem;
              }
              .container {
                  max-width: 800px;
                  margin: auto;
                  background-color: #f9fafb;
                  border-radius: 8px;
                  padding: 2.5rem;
                  border: 1px solid #e5e7eb;
              }
              h1, h2, h3 {
                  color: #111827;
              }
              h1 {
                  font-size: 2.25rem;
                  margin-bottom: 1em;
                  line-height: 1.2;
              }
              h2, h3 {
                  border-bottom: 2px solid #e5e7eb;
                  padding-bottom: 0.3em;
                  margin-top: 1.5em;
              }
              h2 { font-size: 1.75rem; }
              h3 { font-size: 1.5rem; }
              p {
                  margin-bottom: 1.2em;
              }
              strong {
                  color: #000;
              }
              ul, ol {
                  padding-left: 20px;
                  margin-bottom: 1em;
              }
              li {
                  margin-bottom: 0.5em;
              }
              a {
                  color: #06b6d4;
                  text-decoration: none;
              }
              a:hover {
                  text-decoration: underline;
              }
              blockquote {
                  border-left: 4px solid #06b6d4;
                  padding-left: 1rem;
                  margin: 1.5em 0;
                  color: #6b7280;
                  font-style: italic;
              }
              figure {
                  margin: 2em 0;
                  text-align: center;
              }
              figure img {
                  max-width: 100%;
                  height: auto;
                  border-radius: 8px;
              }
              figure figcaption {
                  font-size: 0.8em;
                  color: #888;
                  margin-top: 0.5em;
              }
              .sources-section {
                  margin-top: 3rem;
                  padding-top: 1.5rem;
                  border-top: 1px solid #e5e7eb;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="post-content">
                  <h1>${title}</h1>
                  ${post}
              </div>
          </div>
      </body>
      </html>
    `;

    navigator.clipboard.writeText(fullHtml).then(() => {
      setCopyStatus(prev => ({ ...prev, full: '복사 완료!' }));
      setTimeout(() => {
          setCopyStatus(prev => ({ ...prev, full: '전체 파일로 복사' }));
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy full file: ', err);
      setCopyStatus(prev => ({ ...prev, full: '복사 실패' }));
      setTimeout(() => {
        setCopyStatus(prev => ({ ...prev, full: '전체 파일로 복사' }));
    }, 2000);
    });
  };
  
    const handleCopyTags = () => {
    if (tags.length === 0) return;
    navigator.clipboard.writeText(tags.join(', ')).then(() => {
      setCopyStatus(prev => ({ ...prev, tags: '복사 완료!' }));
      setTimeout(() => {
        setCopyStatus(prev => ({ ...prev, tags: '태그 복사' }));
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy tags: ', err);
      setCopyStatus(prev => ({ ...prev, tags: '복사 실패' }));
      setTimeout(() => {
        setCopyStatus(prev => ({ ...prev, tags: '태그 복사' }));
      }, 2000);
    });
  };

  const baseContentClasses = "max-w-none text-gray-700 dark:text-gray-300 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-cyan-700 dark:[&_h2]:text-cyan-400 [&_h2]:border-b [&_h2]:border-gray-300 dark:[&_h2]:border-gray-600 [&_h2]:pb-2 [&_h2]:mb-6 [&_h2]:mt-8 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-cyan-600 dark:[&_h3]:text-cyan-300 [&_h3]:mt-6 [&_h3]:mb-4 [&_strong]:text-gray-900 dark:[&_strong]:text-cyan-200 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-2 [&_p]:mb-4 [&_a]:text-blue-600 dark:[&_a]:text-blue-400 hover:[&_a]:text-blue-500 dark:hover:[&_a]:text-blue-300 hover:[&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-cyan-500 dark:[&_blockquote]:border-cyan-400 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-4 [&_blockquote]:text-gray-600 dark:[&_blockquote]:text-gray-400";
  
  const contentClassName = `${baseContentClasses} ${fontSizeClassMap[fontSize]} ${lineHeightClassMap[lineHeight]}`;

  return (
    <div className="bg-transparent h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Font Size Controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">글자 크기</span>
            <StyleButton onClick={() => setFontSize('sm')} isActive={fontSize === 'sm'}>작게</StyleButton>
            <StyleButton onClick={() => setFontSize('base')} isActive={fontSize === 'base'}>보통</StyleButton>
            <StyleButton onClick={() => setFontSize('lg')} isActive={fontSize === 'lg'}>크게</StyleButton>
          </div>
          {/* Line Height Controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">줄 간격</span>
            <StyleButton onClick={() => setLineHeight('normal')} isActive={lineHeight === 'normal'}>좁게</StyleButton>
            <StyleButton onClick={() => setLineHeight('relaxed')} isActive={lineHeight === 'relaxed'}>보통</StyleButton>
            <StyleButton onClick={() => setLineHeight('loose')} isActive={lineHeight === 'loose'}>넓게</StyleButton>
          </div>
        </div>

        {/* Copy Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCopyBodyOnly}
            className="bg-cyan-500 text-white hover:bg-cyan-600 font-semibold py-2 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            aria-label="블로그용 본문 복사"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            {copyStatus.body}
          </button>
          <button
            onClick={handleCopyFullFile}
            className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold py-2 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            aria-label="전체 파일로 복사"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copyStatus.full}
          </button>
        </div>
      </div>

      <div className="p-6 overflow-auto flex-grow">
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-white mb-6 pb-4 border-b border-gray-300 dark:border-gray-600">
          {title}
        </h1>
        {tags && tags.length > 0 && (
          <div className="mb-8 p-4 bg-gray-100 dark:bg-gray-900/50 rounded-lg">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200">추천 태그</h4>
                <button
                    onClick={handleCopyTags}
                    className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold py-1 px-3 rounded-lg transition-colors text-xs flex items-center justify-center gap-2"
                    aria-label="태그 복사"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    {copyStatus.tags}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                  {tags.map((tag, index) => (
                      <span key={index} className="bg-cyan-100 dark:bg-cyan-900/50 text-cyan-800 dark:text-cyan-200 px-3 py-1 rounded-full text-sm font-medium">
                          #{tag}
                      </span>
                  ))}
              </div>
          </div>
        )}
        <div
          className={contentClassName}
          dangerouslySetInnerHTML={{ __html: post }}
        />
      </div>
    </div>
  );
};

export default BlogPostDisplay;