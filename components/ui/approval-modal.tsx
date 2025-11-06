// Approval Modal Component - For AI SDK v6 tool approval flow
// Used when agent requires user confirmation for sensitive operations

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { Badge } from './badge';
import { cn } from '../../lib/utils';

export interface ToolApprovalRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
  reason?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface ApprovalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: ToolApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
  autoCloseOnAction?: boolean;
}

/**
 * Approval Modal - User confirmation for sensitive tool operations
 *
 * Usage:
 * ```tsx
 * const [approvalOpen, setApprovalOpen] = useState(false);
 * const [currentApproval, setCurrentApproval] = useState<ToolApprovalRequest | null>(null);
 *
 * <ApprovalModal
 *   open={approvalOpen}
 *   onOpenChange={setApprovalOpen}
 *   approval={currentApproval!}
 *   onApprove={() => {
 *     handleApprove(currentApproval.toolCallId);
 *     setApprovalOpen(false);
 *   }}
 *   onReject={() => {
 *     handleReject(currentApproval.toolCallId);
 *     setApprovalOpen(false);
 *   }}
 * />
 * ```
 */
export function ApprovalModal({
  open,
  onOpenChange,
  approval,
  onApprove,
  onReject,
  autoCloseOnAction = true,
}: ApprovalModalProps) {
  const closeReasonRef = React.useRef<'approve' | 'reject' | null>(null);

  React.useEffect(() => {
    closeReasonRef.current = null;
  }, [open]);

  const handleApprove = () => {
    closeReasonRef.current = 'approve';
    onApprove();
    if (autoCloseOnAction) {
      onOpenChange(false);
    }
  };

  const handleReject = () => {
    closeReasonRef.current = 'reject';
    onReject();
    if (autoCloseOnAction) {
      onOpenChange(false);
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (closeReasonRef.current === null) {
        onReject();
      }
      onOpenChange(false);
    } else {
      onOpenChange(true);
    }
    closeReasonRef.current = null;
  };

  const getRiskColor = (level: string = 'medium') => {
    switch (level) {
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'navigate':
        return '🌐';
      case 'click':
        return '👆';
      case 'type':
        return '⌨️';
      case 'screenshot':
        return '📸';
      default:
        return '🔧';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{getToolIcon(approval.toolName)}</span>
            Tool Approval Required
          </DialogTitle>
          <DialogDescription>
            The AI agent wants to execute a tool action. Please review and confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tool Name & Risk Level */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Tool</p>
              <p className="text-sm text-gray-600 font-mono">{approval.toolName}</p>
            </div>
            {approval.riskLevel && (
              <Badge
                variant="outline"
                className={cn('text-xs font-medium', getRiskColor(approval.riskLevel))}
              >
                {approval.riskLevel.toUpperCase()} RISK
              </Badge>
            )}
          </div>

          {/* Arguments */}
          <div>
            <p className="text-sm font-medium text-gray-900 mb-2">Parameters</p>
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              {Object.entries(approval.args).map(([key, value]) => (
                <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-1">
                  <span className="text-sm font-medium text-gray-700 min-w-[80px]">
                    {key}:
                  </span>
                  <span className="text-sm text-gray-900 font-mono break-all">
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reason */}
          {approval.reason && (
            <div>
              <p className="text-sm font-medium text-gray-900 mb-2">Reason</p>
              <p className="text-sm text-gray-600 bg-blue-50 rounded-lg p-3 border border-blue-200">
                {approval.reason}
              </p>
            </div>
          )}

          {/* Warning for high risk */}
          {approval.riskLevel === 'high' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-medium text-red-800 flex items-center gap-2">
                <span>⚠️</span>
                High Risk Action
              </p>
              <p className="text-xs text-red-600 mt-1">
                This action may have significant consequences. Please review carefully before approving.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleReject}
            className="w-full sm:w-auto"
          >
            ✗ Reject
          </Button>
          <Button
            type="button"
            onClick={handleApprove}
            className="w-full sm:w-auto"
          >
            ✓ Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact Approval Toast - Alternative lightweight UI for approvals
 */
export interface ApprovalToastProps {
  approval: ToolApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
  className?: string;
}

export function ApprovalToast({ approval, onApprove, onReject, className }: ApprovalToastProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 p-4 bg-white border border-gray-200 rounded-lg shadow-lg',
        className
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-2xl flex-shrink-0">{getToolIcon(approval.toolName)}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            Approve <code className="font-mono text-xs">{approval.toolName}</code>?
          </p>
          <p className="text-xs text-gray-600 truncate">
            {Object.entries(approval.args).slice(0, 1).map(([k, v]) => `${k}: ${v}`).join(', ')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="h-8 px-3"
        >
          ✗
        </Button>
        <Button
          size="sm"
          onClick={onApprove}
          className="h-8 px-3"
        >
          ✓
        </Button>
      </div>
    </div>
  );
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'navigate':
      return '🌐';
    case 'click':
      return '👆';
    case 'type':
      return '⌨️';
    case 'screenshot':
      return '📸';
    case 'scroll':
      return '📜';
    case 'hover':
      return '🖱️';
    case 'dragDrop':
      return '↔️';
    default:
      return '🔧';
  }
}
