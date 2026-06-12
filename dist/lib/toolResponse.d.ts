export interface ToolError {
    code: string;
    message: string;
    retryable: boolean;
    source?: string;
}
export interface ToolSuccess<T> {
    success: true;
    data: T;
    error: null;
    timestamp: string;
}
export interface ToolFailure {
    success: false;
    data: null;
    error: ToolError;
    timestamp: string;
}
export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;
export declare function ok<T>(data: T, timestamp?: string): ToolSuccess<T>;
export declare function fail(code: string, message: string, retryable?: boolean, source?: string, timestamp?: string): ToolFailure;
export declare function errorMessage(err: unknown): string;
export declare function classifyExternalError(source: string, err: unknown): ToolFailure;
export declare function requireWriteToolsEnabled(toolName: string): ToolFailure | null;
export declare function requireEnv(name: string, source: string): string | ToolFailure;
//# sourceMappingURL=toolResponse.d.ts.map