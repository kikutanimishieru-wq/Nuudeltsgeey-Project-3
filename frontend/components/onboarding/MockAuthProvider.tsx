'use client';
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import { initialMockState, mockAuthReducer, type MockAction, type MockState } from '@/lib/mock-auth';
export const MockAuthContext = createContext<{ state: MockState; dispatch: Dispatch<MockAction> } | null>(null);
export default function MockAuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(mockAuthReducer, initialMockState);
  return <MockAuthContext.Provider value={{ state, dispatch }}>{children}</MockAuthContext.Provider>;
}
export function useMockAuth() {
  const context = useContext(MockAuthContext);
  if (!context) throw new Error('MOCK_AUTH_PROVIDER_REQUIRED');
  return context;
}
