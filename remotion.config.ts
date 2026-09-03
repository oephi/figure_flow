/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
// PNG rather than the default JPEG: line art on flat backgrounds shows JPEG
// ringing artefacts around every stroke.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
