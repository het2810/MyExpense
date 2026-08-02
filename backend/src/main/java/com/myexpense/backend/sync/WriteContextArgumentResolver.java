package com.myexpense.backend.sync;

import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Lets a controller method declare a {@link WriteContext} parameter. Returns the
 * context {@link WriteContextFilter} parsed for this request, or
 * {@link WriteContext#NONE} when the filter did not run (a path it skips).
 */
public class WriteContextArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return WriteContext.class.equals(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        Object value = webRequest.getAttribute(WriteContext.REQUEST_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        return value instanceof WriteContext context ? context : WriteContext.NONE;
    }
}
