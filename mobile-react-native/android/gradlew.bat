@REM Copyright (c) Meta Platforms, Inc. and affiliates.
@REM
@REM This source code is licensed under the MIT license found in the
@REM LICENSE file in the root directory of this source tree.

@rem
@rem Copyright 2015 the original author or authors.
@rem
@rem Licensed under the Apache License, Version 2.0 (the "License");
@rem you may not use this file except in compliance with the License.
@rem You may obtain a copy of the License at
@rem
@rem      https://www.apache.org/licenses/LICENSE-2.0
@rem
@rem Unless required by applicable law or agreed to in writing, software
@rem distributed under the License is distributed on an "AS IS" BASIS,
@rem WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
@rem See the License for the specific language governing permissions and
@rem limitations under the License.
@rem
@rem SPDX-License-Identifier: Apache-2.0
@rem

@if "%DEBUG%"=="" @echo off
@rem ##########################################################################
@rem
@rem  Gradle startup script for Windows
@rem
@rem ##########################################################################

@rem Set local scope for the variables with windows NT shell
if "%OS%"=="Windows_NT" setlocal

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
@rem This is normally unused
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

@rem Resolve any "." and ".." in APP_HOME to make it shorter.
for %%i in ("%APP_HOME%") do set APP_HOME=%%~fi

@rem Add default JVM options here. You can also use JAVA_OPTS and GRADLE_OPTS to pass JVM options to this script.
set DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"

@rem Canonical Android build environment for this checkout.
if not defined GRADLE_USER_HOME set GRADLE_USER_HOME=E:\codex\android-toolchain\gradle
if not defined GRADLE_OPTS set "GRADLE_OPTS=-Dorg.gradle.native=false -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=10816 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=10816"
if exist "E:\.android" set "ANDROID_USER_HOME=E:\.android"
set "ANDROID_SDK_HOME="
if not defined org.gradle.native.dir set "org.gradle.native.dir=E:\liuliu-agent-music\.gradle-native"

@rem Find java.exe
if defined JAVA_HOME goto findJavaFromJavaHome

@rem Canonical project JDK fallback. This keeps command-line builds working in
@rem newly created Codex windows where JAVA_HOME has not been inherited.
if exist "E:\codex\android-toolchain\jdk\jdk-17.0.20+8\bin\java.exe" (
  set JAVA_HOME=E:\codex\android-toolchain\jdk\jdk-17.0.20+8
  goto findJavaFromJavaHome
)

set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute

echo. 1>&2
echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH. 1>&2
echo. 1>&2
echo Please set the JAVA_HOME variable in your environment to match the 1>&2
echo location of your Java installation. 1>&2

goto fail

:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%/bin/java.exe

if exist "%JAVA_EXE%" goto execute

echo. 1>&2
echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME% 1>&2
echo. 1>&2
echo Please set the JAVA_HOME variable in your environment to match the 1>&2
echo location of your Java installation. 1>&2

goto fail

:execute
@rem Setup the command line



@rem Use the E: drive Gradle 8.14.3 distribution directly when available.
set DIRECT_GRADLE=E:\codex\android-toolchain\gradle\wrapper\dists\gradle-8.14.3-bin\5krj5o1v38q6bs49bitucyjke\gradle-8.14.3\bin\gradle.bat
if exist "%DIRECT_GRADLE%" (
  call "%DIRECT_GRADLE%" --no-daemon --no-problems-report -Dorg.gradle.native=false %*
  set EXIT_CODE=%ERRORLEVEL%
  goto directEnd
)

@rem Execute Gradle
@rem The checked-in problems report can be held open by Windows preview/indexing.
@rem Disable that optional HTML report so a successful Android build cannot be
@rem turned into AccessDeniedException at finalization. Explicit caller args
@rem come last and can still override this default when the report is needed.
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=%APP_BASE_NAME%" -jar "%APP_HOME%\gradle\wrapper\gradle-wrapper.jar" --no-problems-report %*

:end
@rem End local scope for the variables with windows NT shell
if %ERRORLEVEL% equ 0 goto mainEnd

:fail
rem Set variable GRADLE_EXIT_CONSOLE if you need the _script_ return code instead of
rem the _cmd.exe /c_ return code!
set EXIT_CODE=%ERRORLEVEL%
if %EXIT_CODE% equ 0 set EXIT_CODE=1
if not ""=="%GRADLE_EXIT_CONSOLE%" exit %EXIT_CODE%
exit /b %EXIT_CODE%

:mainEnd
if "%OS%"=="Windows_NT" endlocal

:directEnd
if "%OS%"=="Windows_NT" endlocal
exit /b %EXIT_CODE%

:omega
