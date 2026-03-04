import { useState, useEffect } from 'react';
import { Button, Card, CardBody } from '@heroui/react';
import * as api from '../../services/api';

export function JoinRequests() {
  const [requests, setRequests] = useState<
    Array<{ id: string; username: string; display_name: string; status: string; created_at: string }>
  >([]);

  const loadRequests = async () => {
    try {
      const data = await api.listJoinRequests();
      setRequests(data);
    } catch {}
  };

  useEffect(() => {
    loadRequests();
    const interval = setInterval(loadRequests, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (id: string) => {
    try {
      await api.approveRequest(id);
      await loadRequests();
    } catch {}
  };

  const handleDeny = async (id: string) => {
    try {
      await api.denyRequest(id);
      await loadRequests();
    } catch {}
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-4">Join Requests</h3>

      <div className="space-y-2">
        {requests.map((req) => (
          <Card key={req.id}>
            <CardBody className="flex-row items-center justify-between py-3">
              <div>
                <p className="text-foreground font-medium">{req.display_name}</p>
                <p className="text-sm text-default-500">@{req.username}</p>
                <p className="text-xs text-default-400 mt-1">
                  {new Date(req.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button color="success" size="sm" onPress={() => handleApprove(req.id)}>
                  Approve
                </Button>
                <Button color="danger" size="sm" onPress={() => handleDeny(req.id)}>
                  Deny
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
        {requests.length === 0 && (
          <p className="text-default-500 text-sm">No pending requests.</p>
        )}
      </div>
    </div>
  );
}
