import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './lib/auth';
import Login from './pages/Login';
import Home from './pages/Home';
import Library from './pages/Library';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';
import Admin from './pages/Admin';
import Nav from './components/Nav';

function App() {
  const { isAuthenticated, hasHydrated } = useAuthStore((state) => ({
    isAuthenticated: state.isAuthenticated,
    hasHydrated: state.hasHydrated,
  }));

  // Safety timeout: if not hydrated after 2 seconds, force hydration
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasHydrated) {
        console.warn('[App] Forcing hydration after timeout');
        useAuthStore.setState({ hasHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [hasHydrated]);

  if (!hasHydrated) {
    return (
      <div className="min-h-screen bg-obsidian-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-polaris-500 mx-auto mb-4" />
          <p className="text-obsidian-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-obsidian-950">
        <Nav />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/books/:id" element={<BookDetail />} />
            <Route path="/read/:bookId/:fileId" element={<Reader />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
