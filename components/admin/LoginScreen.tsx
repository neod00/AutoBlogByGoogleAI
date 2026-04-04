import React, { useState } from 'react';

interface LoginScreenProps {
  onLoginSuccess: (token: string) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${password}`
        }
      });

      if (res.ok) {
        onLoginSuccess(password);
      } else {
        const data = await res.json();
        setError(data.error || '인증에 실패했습니다.');
      }
    } catch (err) {
      setError('서버 연결 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="relative w-full max-w-md p-8 overflow-hidden bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl border border-white/20 dark:border-gray-700/50 rounded-2xl shadow-2xl">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-500"></div>
        
        <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-white mb-6">
          🔐 Admin Dashboard
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              관리자 비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition dark:text-white"
              placeholder="••••••••"
              autoFocus
            />
          </div>
          
          {error && (
            <div className="text-red-500 text-sm text-center bg-red-100 dark:bg-red-900/30 p-2 rounded-lg">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 px-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-600 hover:to-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/30"
          >
            {loading ? '인증 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
