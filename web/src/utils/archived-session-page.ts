export const ARCHIVED_SESSION_PAGE_SIZE = 25;
export const ARCHIVED_SESSION_AUTO_LOAD_ROOT_MARGIN_PX = 256;

export interface ArchivedSessionPageState {
  loaded: boolean;
  loading: boolean;
  total: number | null;
  hasMore: boolean;
  nextOffset: number;
  ids: string[];
  error: string | null;
}
