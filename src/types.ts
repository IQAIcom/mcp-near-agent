export type AgentEvent = {
	eventType: string;
	requestId: string;
	payload: any;
	sender: string;
	timestamp: number;
};
