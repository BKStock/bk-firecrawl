import { generateObject } from "ai";
import * as Sentry from "@sentry/node";
import { logger } from "../logger";
import { config } from "../../config";
import { BrandingEnhancement, getBrandingEnhancementSchema } from "./schema";
import { buildBrandingPrompt } from "./prompt";
import { BrandingLLMInput } from "./types";
import { getModel } from "../generic-ai";

function isDebugBrandingEnabled(input: BrandingLLMInput): boolean {
  return (
    config.DEBUG_BRANDING === true || input.teamFlags?.debugBranding === true
  );
}

export async function enhanceBrandingWithLLM(
  input: BrandingLLMInput,
): Promise<BrandingEnhancement> {
  const prompt = buildBrandingPrompt(input);

  // Smart model selection: use more powerful model for complex cases
  // gpt-4o-mini: cheaper, good for simple cases
  // gpt-4o: more capable, better for complex prompts with many buttons/logos
  const buttonsCount = input.buttons?.length || 0;
  const logoCandidatesCount = input.logoCandidates?.length || 0;
  const promptLength = prompt.length;

  // Use gpt-4o for complex cases:
  // - Many buttons (>8)
  // - Many logo candidates (>5)
  // - Long prompt (>8000 chars)
  // - Has screenshot (adds complexity)
  const isComplexCase =
    buttonsCount > 8 ||
    logoCandidatesCount > 5 ||
    promptLength > 8000 ||
    !!input.screenshot;

  const modelName = isComplexCase ? "gpt-4o" : "gpt-4o-mini";
  const model = getModel(modelName);

  if (isDebugBrandingEnabled(input)) {
    const logoCandidates = input.logoCandidates || [];
    const logoCandidateFiles = logoCandidates.map(candidate => ({
      src: candidate.src,
      href: candidate.href,
      alt: candidate.alt,
      location: candidate.location,
      width: Math.round(candidate.position?.width || 0),
      height: Math.round(candidate.position?.height || 0),
      isSvg: candidate.isSvg,
      indicators: candidate.indicators,
    }));
    const screenshotLength = input.screenshot ? input.screenshot.length : 0;

    logger.info("LLM model selection", {
      model: modelName,
      buttonsCount,
      logoCandidatesCount,
      promptLength,
      hasScreenshot: !!input.screenshot,
      isComplexCase,
    });

    logger.info("LLM branding prompt (full)", { prompt });
    logger.info("LLM branding input files", {
      logoCandidates: logoCandidateFiles,
      screenshot: {
        provided: !!input.screenshot,
        length: screenshotLength,
        preview: input.screenshot ? input.screenshot.slice(0, 48) + "..." : "",
      },
    });

    logger.debug("LLM branding prompt preview", {
      promptStart: prompt.substring(0, 500),
      promptEnd: prompt.substring(prompt.length - 500),
      buttonsPreview: input.buttons?.slice(0, 3).map(b => ({
        text: b.text?.substring(0, 50),
        background: b.background,
      })),
    });
  }

  try {
    // Use schema with logoSelection only if logo candidates are provided
    const hasLogoCandidates = !!(
      input.logoCandidates && input.logoCandidates.length > 0
    );
    const schema = getBrandingEnhancementSchema(hasLogoCandidates);

    const result = await generateObject({
      model,
      schema,
      providerOptions: {
        openai: {
          strictJsonSchema: true,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are a brand design expert analyzing websites to extract accurate branding information.",
        },
        {
          role: "user",
          content: input.screenshot
            ? [
                { type: "text", text: prompt },
                { type: "image", image: input.screenshot },
              ]
            : prompt,
        },
      ],
      temperature: 0.1,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "enhanceBrandingWithLLM",
        metadata: {
          teamId: input.teamId || "unknown",
        },
      },
    });

    if (isDebugBrandingEnabled(input)) {
      const reasoningPreview = result.reasoning
        ? result.reasoning.length > 1000
          ? result.reasoning.substring(0, 1000) + "..."
          : result.reasoning
        : undefined;

      // Type assertion to handle optional logoSelection
      const resultObject = result.object as BrandingEnhancement;

      logger.info("LLM branding response", {
        model: modelName,
        buttonsCount,
        logoCandidatesCount,
        promptLength,
        hasScreenshot: !!input.screenshot,
        usage: result.usage,
        finishReason: result.finishReason,
        reasoning: reasoningPreview,
        reasoningLength: result.reasoning?.length || 0,
        warnings: result.warnings,
        hasObject: !!resultObject,
        objectKeys: resultObject ? Object.keys(resultObject) : [],
        buttonClassification: resultObject?.buttonClassification,
        colorRoles: resultObject?.colorRoles,
        cleanedFontsLength: resultObject?.cleanedFonts?.length || 0,
        logoSelection: resultObject?.logoSelection,
      });

      if (result.reasoning && result.reasoning.length > 1000) {
        logger.debug("LLM full reasoning", {
          reasoning: result.reasoning,
        });
      }
    }

    // Type assertion to handle optional logoSelection
    return result.object as BrandingEnhancement;
  } catch (error) {
    Sentry.withScope(scope => {
      scope.setTag("feature", "branding-llm");
      scope.setTag("model", modelName);
      scope.setContext("branding_llm", {
        url: input.url,
        buttonsCount: input.buttons?.length || 0,
        logoCandidatesCount: input.logoCandidates?.length || 0,
        promptLength: prompt.length,
        hasScreenshot: !!input.screenshot,
      });
      Sentry.captureException(error);
    });

    logger.error("LLM branding enhancement failed", {
      error,
      buttonsCount: input.buttons?.length || 0,
      promptLength: prompt.length,
    });

    return {
      cleanedFonts: [],
      buttonClassification: {
        primaryButtonIndex: -1,
        primaryButtonReasoning: "LLM failed",
        secondaryButtonIndex: -1,
        secondaryButtonReasoning: "LLM failed",
        confidence: 0,
      },
      colorRoles: {
        primaryColor: "",
        accentColor: "",
        backgroundColor: "",
        textPrimary: "",
        confidence: 0,
      },
      personality: {
        tone: "professional",
        energy: "medium",
        targetAudience: "unknown",
      },
      designSystem: {
        framework: "unknown",
        componentLibrary: "",
      },
      logoSelection: {
        selectedLogoIndex: -1,
        selectedLogoReasoning: "LLM failed",
        confidence: 0,
      },
    };
  }
}
