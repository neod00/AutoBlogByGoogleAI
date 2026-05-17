import React, { useState, useEffect } from 'react';
import LoginScreen from './components/admin/LoginScreen';
import AdminDashboard from './components/admin/AdminDashboard'; // To be created

type Theme = 'light' | 'dark';

const AdminApp: React.FC = () => {
  const [token, setToken] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  // 초기 테마 설정
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

  // 세션(토큰) 확인
  useEffect(() => {
    const savedToken = localStorage.getItem('adminToken');
    if (savedToken) {
      // 서버를 통해 유효성 검증 시도
      fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${savedToken}` }
      })
      .then(res => {
        if (res.ok) {
          setToken(savedToken);
        } else {
          localStorage.removeItem('adminToken');
        }
      })
      .catch(() => {})
      .finally(() => setIsCheckingSession(false));
    } else {
      setIsCheckingSession(false);
    }
  }, []);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleLoginSuccess = (newToken: string) => {
    localStorage.setItem('adminToken', newToken);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setToken(null);
  };

  if (isCheckingSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 transition-colors duration-300 font-sans">
      <header className="fixed top-0 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-50 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xl">🛠️</span>
          <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-500">
            AI Blog Admin (AutoPilot Ready)
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm text-slate-500 hover:text-cyan-500 transition">퍼블릭 화면 가기 →</a>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          {token && (
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              로그아웃
            </button>
          )}
        </div>
      </header>

      <main className="pt-24 pb-12 px-4 max-w-6xl mx-auto">
        {!token ? (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        ) : (
          <AdminDashboard token={token} />
        )}
      </main>
    </div>
  );
};

export default AdminApp;
