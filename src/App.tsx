import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import WorkoutPage from './pages/Workout'
import FoodPage from './pages/Food'
import ActivityPage from './pages/Activity'
import BodyPage from './pages/Body'
import ProgressPage from './pages/Progress'
import HowPage from './pages/How'
import Ab60Page from './pages/Ab60'
import { UndoHost } from './lib/undo'

const tabs = [
  { to: '/workout', label: 'Lift', icon: '🏋️' },
  { to: '/food', label: 'Food', icon: '🍛' },
  { to: '/activity', label: 'Steps', icon: '👟' },
  { to: '/body', label: 'Body', icon: '📏' },
  { to: '/progress', label: 'Progress', icon: '📈' },
  { to: '/ab60', label: 'AB60', icon: '🐢' },
]

export default function App() {
  return (
    <div className="mx-auto max-w-md min-h-screen pb-24 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <Routes>
        <Route path="/workout" element={<WorkoutPage />} />
        <Route path="/food" element={<FoodPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/body" element={<BodyPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/ab60" element={<Ab60Page />} />
        <Route path="/how" element={<HowPage />} />
        <Route path="*" element={<Navigate to="/workout" replace />} />
      </Routes>
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-md grid grid-cols-6">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex flex-col items-center py-2.5 text-[11px] gap-0.5 ${isActive ? 'text-lime-400' : 'text-zinc-500'}`}>
              <span className="text-lg">{t.icon}</span>{t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <UndoHost />
    </div>
  )
}
