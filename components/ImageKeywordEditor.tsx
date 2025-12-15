import React, { useState } from 'react';

interface ImageKeywordEditorProps {
  keywords: string[];
  onConfirm: (keywords: string[]) => void;
  onSkip: () => void;
  isLoading: boolean;
}

const ImageKeywordEditor: React.FC<ImageKeywordEditorProps> = ({
  keywords,
  onConfirm,
  onSkip,
  isLoading
}) => {
  const [editedKeywords, setEditedKeywords] = useState<string[]>(() => {
    // Ensure we always have 3 keyword slots
    const initial = [...keywords];
    while (initial.length < 3) {
      initial.push('');
    }
    return initial.slice(0, 3);
  });

  const handleKeywordChange = (index: number, value: string) => {
    const newKeywords = [...editedKeywords];
    newKeywords[index] = value;
    setEditedKeywords(newKeywords);
  };

  const handleConfirm = () => {
    const validKeywords = editedKeywords.filter(kw => kw.trim() !== '');
    onConfirm(validKeywords);
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-cyan-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-6 border border-indigo-200 dark:border-gray-700 shadow-lg">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">이미지 검색 키워드</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Pexels에서 검색할 영어 키워드를 확인하거나 수정하세요</p>
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {editedKeywords.map((keyword, index) => (
          <div key={index} className="flex items-center gap-3">
            <span className="w-6 h-6 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center text-sm font-semibold shrink-0">
              {index + 1}
            </span>
            <input
              type="text"
              value={keyword}
              onChange={(e) => handleKeywordChange(index, e.target.value)}
              placeholder={`이미지 키워드 ${index + 1} (영어)`}
              className="flex-grow bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition placeholder:text-gray-400 dark:placeholder:text-gray-500"
              disabled={isLoading}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleConfirm}
          disabled={isLoading || editedKeywords.every(kw => kw.trim() === '')}
          className="flex-1 px-6 py-3 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition-colors disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              이미지 검색 중...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              이미지 검색하기
            </>
          )}
        </button>
        <button
          onClick={onSkip}
          disabled={isLoading}
          className="flex-1 sm:flex-initial px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          이미지 없이 완료
        </button>
      </div>

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
        💡 팁: 구체적인 영어 키워드를 사용하면 더 관련성 높은 이미지를 찾을 수 있습니다
      </p>
    </div>
  );
};

export default ImageKeywordEditor;

