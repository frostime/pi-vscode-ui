export interface ProxyCredentials {
  username: string;
  password: string;
}

export interface ProxyCredentialsProvider {
  get(): Promise<ProxyCredentials | undefined>;
}
