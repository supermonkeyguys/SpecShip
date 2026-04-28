import type { ProjectsResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export function fetchProjects(): Promise<ProjectsResponse> {
  return fetchJSON<ProjectsResponse>("/api/projects");
}
