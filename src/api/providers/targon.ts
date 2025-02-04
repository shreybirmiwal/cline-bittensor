import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, TargonModelId, ModelInfo, targonDefaultModelId, targonModels } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"

import * as fs from "fs"
import * as path from "path"
const filePath = path.join(__dirname, "openai_messages_dump.json")

export class TargonHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			// baseURL: "https://api.targon.com/v1",
			// apiKey: "sn4_nsz99yxqenqv1qoqxs7towb43a25",

			baseURL: "https://chatapi.akash.network/api/v1",
			apiKey: "sk-bOEWn0zrEWUWkIgLn4gGoA",
		})

		this.testCompletion()
	}

	private async testCompletion() {
		try {
			const model = this.getModel()
			const stream = await this.client.chat.completions.create({
				model: model.id,
				stream: true,
				messages: [
					{ role: "system", content: "You are a helpful programming assistant." },
					{
						role: "user",
						content: "Write a bubble sort implementation in TypeScript with comments explaining how it works",
					},
				],
				temperature: 0.7,
				max_tokens: 256,
				top_p: 0.1,
				frequency_penalty: 0,
				presence_penalty: 0,
			})
			for await (const chunk of stream) {
				const content = chunk.choices[0]?.delta?.content || ""
				//process.stdout.write(content);
			}
		} catch (error) {
			console.error("Error:", error)
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		console.log("STARTING CREATE MESSAGE")
		const isDeepseekReasoner = model.id.includes("deepseek-reasoner")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await this.client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			// messages: [
			// 	{ role: "system", content: "You are a helpful programming assistant." },
			// 	{
			// 		role: "user",
			// 		content: "Write a bubble sort implementation in TypeScript with comments explaining how it works",
			// 	},
			// ],
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			// Only set temperature for non-reasoner models
			...(model.id === "deepseek-reasoner" ? {} : { temperature: 0 }),
		})

		let final = ""
		for await (const chunk of stream) {
			console.log("CHUNK", chunk)
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
				final += delta.content
				//console.log("DELTA", delta)
			} else {
				console.log("NO DELTA")
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0, // (deepseek reports total input AND cache reads/writes, see context caching: https://api-docs.deepseek.com/guides/kv_cache) where the input tokens is the sum of the cache hits/misses, while anthropic reports them as separate tokens. This is important to know for 1) context management truncation algorithm, and 2) cost calculation (NOTE: we report both input and cache stats but for now set input price to 0 since all the cost calculation will be done using cache hits/misses)
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-ignore-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}

		console.log("FINAL", final)
	}

	getModel(): { id: TargonModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in targonModels) {
			const id = modelId as TargonModelId
			return { id, info: targonModels[id] }
		}
		return {
			id: targonDefaultModelId,
			info: targonModels[targonDefaultModelId],
		}
	}
}
