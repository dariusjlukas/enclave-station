import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Spinner,
  Accordion,
  AccordionItem,
} from '@heroui/react';
import { useAuth } from './hooks/useAuth';
import { useChatStore } from './stores/chatStore';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { RecoveryLogin } from './components/auth/RecoveryLogin';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ChatArea } from './components/layout/ChatArea';
import { CreateChannel } from './components/channels/CreateChannel';
import { ChannelBrowser } from './components/channels/ChannelBrowser';
import { ChannelSettings } from './components/channels/ChannelSettings';
import { InviteManager } from './components/admin/InviteManager';
import { JoinRequests } from './components/admin/JoinRequests';
import { ServerSettings } from './components/admin/ServerSettings';
import { SetupWizard } from './components/admin/SetupWizard';
import { UserSettings } from './components/settings/UserSettings';
import * as api from './services/api';

type AuthPage = 'login' | 'register' | 'recovery';

function App() {
  const { isAuthenticated, loading } = useAuth();
  const [authPage, setAuthPage] = useState<AuthPage>('login');
  const [showCreateModal, setShowCreateModal] = useState<
    'channel' | 'dm' | null
  >(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChannelBrowser, setShowChannelBrowser] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const setChannels = useChatStore((s) => s.setChannels);
  const setUsers = useChatStore((s) => s.setUsers);
  const user = useChatStore((s) => s.user);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channels = useChatStore((s) => s.channels);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  useEffect(() => {
    if (!isAuthenticated) return;
    api.listChannels().then(setChannels);
    api.listUsers().then(setUsers);

    // Check if admin needs to complete setup
    if (user?.role === 'admin') {
      api.getPublicConfig().then((config) => {
        if (!config.setup_completed) {
          setShowSetupWizard(true);
        }
      });
    }
  }, [isAuthenticated, setChannels, setUsers, user?.role]);

  // Poll pending join requests for admin badge
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin') return;

    const fetchCount = () => {
      api
        .listJoinRequests()
        .then((reqs) => {
          setPendingRequestCount(
            reqs.filter((r) => r.status === 'pending').length,
          );
        })
        .catch(() => {});
    };

    fetchCount();
    const interval = setInterval(fetchCount, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated, user?.role]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    switch (authPage) {
      case 'register':
        return <RegisterPage onSwitchToLogin={() => setAuthPage('login')} />;
      case 'recovery':
        return <RecoveryLogin onSwitchToLogin={() => setAuthPage('login')} />;
      default:
        return (
          <LoginPage
            onSwitchToRegister={() => setAuthPage('register')}
            onSwitchToRecovery={() => setAuthPage('recovery')}
          />
        );
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <Header
        onShowAdmin={() => setShowAdmin(true)}
        onShowSettings={() => setShowSettings(true)}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onShowChannelSettings={() => setShowChannelSettings(true)}
        adminNotificationCount={pendingRequestCount}
      />
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar
          onCreateChannel={() => setShowCreateModal('channel')}
          onStartDM={() => setShowCreateModal('dm')}
          onBrowseChannels={() => setShowChannelBrowser(true)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <ChatArea />
      </div>

      {showCreateModal && (
        <CreateChannel
          mode={showCreateModal}
          onClose={() => setShowCreateModal(null)}
        />
      )}

      {showChannelBrowser && (
        <ChannelBrowser onClose={() => setShowChannelBrowser(false)} />
      )}

      {showChannelSettings && activeChannel && !activeChannel.is_direct && (
        <ChannelSettings
          channel={activeChannel}
          onClose={() => setShowChannelSettings(false)}
        />
      )}

      <Modal
        isOpen={showAdmin}
        onOpenChange={setShowAdmin}
        size="lg"
        scrollBehavior="inside"
        backdrop="opaque"
      >
        <ModalContent>
          <ModalHeader>Admin Panel</ModalHeader>
          <ModalBody className="pb-6">
            <Accordion
              variant="splitted"
              selectionMode="multiple"
              defaultExpandedKeys={['server-settings']}
            >
              <AccordionItem key="server-settings" title="Server Settings">
                <ServerSettings />
              </AccordionItem>
              <AccordionItem key="invite-tokens" title="Invite Tokens">
                <InviteManager />
              </AccordionItem>
              <AccordionItem
                key="join-requests"
                title={
                  <div className="flex items-center justify-between w-full">
                    <span>Join Requests</span>
                    {pendingRequestCount > 0 && (
                      <span className="bg-danger text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {pendingRequestCount}
                      </span>
                    )}
                  </div>
                }
              >
                <JoinRequests />
              </AccordionItem>
            </Accordion>
          </ModalBody>
        </ModalContent>
      </Modal>

      {showSettings && <UserSettings onClose={() => setShowSettings(false)} />}

      {showSetupWizard && (
        <SetupWizard onComplete={() => setShowSetupWizard(false)} />
      )}
    </div>
  );
}

export default App;
