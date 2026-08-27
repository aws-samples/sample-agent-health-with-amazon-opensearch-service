export interface OsRoleMapping {
  osRole: string;
  iamRoleArns: string[];
}

export enum OsRole {
  ALL_ACCESS = "all_access",
  SECURITY_MANAGER = "security_manager",
  ML_FULL_ACCESS = "ml_full_access",
  READ_ALL = "readall",
}
