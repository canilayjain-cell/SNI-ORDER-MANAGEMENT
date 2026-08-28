"use client";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import Nav from "@/components/Nav";
import TabBar from "@/components/TabBar";
import Toast from "@/components/Toast";

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner-lg" />
        <div style={{ fontSize: 13, color: "var(--g600)", fontWeight: 500 }}>Loading...</div>
      </div>
    );
  }

  if (!profile) return null; // redirect to /login already in flight

  return (
    <div>
      <Nav profile={profile} />
      <TabBar role={profile.role} />
      {children}
      <Toast />
    </div>
  );
}

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
