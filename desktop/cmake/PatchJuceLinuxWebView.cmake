# Linux only: JUCE 8.0.9 sends web view messages (including every page resource) between
# the app and its WebKitGTK helper process over a pipe, but
#   - reads the message body without waiting, so a message larger than the pipe buffer
#     (any resource over ~64 KB) arrives in pieces, the stream loses its place and the
#     helper crashes; and
#   - writes the length of the JSON in characters instead of bytes, which breaks on any
#     non-ASCII text.
# This patch waits for the rest of a message and sends the byte length. Windows (WebView2)
# and macOS (WKWebView) do not use this code.
set(file "${JUCE_SOURCE_DIR}/modules/juce_gui_extra/native/juce_WebBrowserComponent_linux.cpp")
file(READ "${file}" src)
if(src MATCHES "NXW_PIPE_PATCH")
    return()
endif()

set(old_read [=[            const auto numBytesExpected = readUnaligned<size_t> (lengthBytes);
            buffer.reserve (numBytesExpected + 1);
            buffer.resize (numBytesExpected);

            if (readIntoBuffer (buffer) != numBytesExpected)
                break;]=])
set(new_read [=[            const auto numBytesExpected = readUnaligned<size_t> (lengthBytes);
            buffer.reserve (numBytesExpected + 1);
            buffer.resize (numBytesExpected);

            // NXW_PIPE_PATCH: the sender writes whole messages, so wait for the rest of this one.
            setBlocking (inChannel, true);
            const auto numBodyBytes = readIntoBuffer (buffer);
            setBlocking (inChannel, false);

            if (numBodyBytes != numBytesExpected)
                break;]=])
set(old_len [=[        auto jsonLength = static_cast<size_t> (json.length());]=])
set(new_len [=[        auto jsonLength = static_cast<size_t> (json.getNumBytesAsUTF8());]=])

string(FIND "${src}" "${old_read}" a)
string(FIND "${src}" "${old_len}" b)
if(a EQUAL -1 OR b EQUAL -1)
    message(WARNING "NXW: JUCE's Linux web view code has changed; the pipe patch was not applied")
    return()
endif()
string(REPLACE "${old_read}" "${new_read}" src "${src}")
string(REPLACE "${old_len}" "${new_len}" src "${src}")
file(WRITE "${file}" "${src}")
message(STATUS "NXW: patched JUCE's Linux web view pipe handling")
