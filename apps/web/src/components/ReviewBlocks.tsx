import type { DiffHunk } from '@remotepad/shared';
import { describeHunk } from '@remotepad/shared';

/**
 * Block-by-block review of the agent's edit.
 *
 * Cursor's model: you do not accept a whole file, you accept the blocks you agree
 * with and reject the rest. "Ignore" here is not cosmetic — the server rebuilds
 * the file with the kept blocks applied and that block reverted, so what you see
 * afterwards is the file you agreed to.
 */
export function ReviewBlocks({
  hunks,
  kept,
  edited,
  onDecide,
  onOpenFile,
}: {
  hunks: DiffHunk[];
  kept: string[];
  /** The user rewrote this file themselves during review. */
  edited: boolean;
  onDecide: (id: string, decision: 'keep' | 'ignore') => void;
  onOpenFile: () => void;
}) {
  if (hunks.length === 0) return null;
  const keptSet = new Set(kept);

  return (
    <div className="review-blocks">
      <div className="review-blocks-head">
        <span className="review-blocks-title">
          {hunks.length} block{hunks.length === 1 ? '' : 's'} to review
        </span>
        {edited && <span className="review-blocks-edited">you edited this file</span>}
        <span className="review-blocks-spacer" />
        <button type="button" className="ghost review-blocks-open" onClick={onOpenFile}>
          Open file
        </button>
      </div>
      <div className="review-blocks-list">
        {hunks.map((hunk, index) => {
          const isKept = keptSet.has(hunk.id);
          return (
            <div className={`review-block ${isKept ? 'kept' : ''}`} key={hunk.id}>
              <span className="review-block-index">{index + 1}</span>
              <span className="review-block-meta" title={hunk.header}>
                {describeHunk(hunk)}
              </span>
              <span className="review-block-spacer" />
              {isKept ? (
                <span className="review-block-state">kept</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="ghost review-block-btn keep"
                    title="Keep this block"
                    onClick={() => onDecide(hunk.id, 'keep')}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="ghost review-block-btn ignore"
                    title="Revert only this block"
                    onClick={() => onDecide(hunk.id, 'ignore')}
                  >
                    Ignore
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
