package com.humhum.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import java.util.Locale;

/**
 * Stores the user's in-app language choice and builds a locale-overridden context so both
 * Activity and non-Activity (notification) surfaces render in the selected language.
 *
 * <p>MainActivity is a {@link androidx.activity.ComponentActivity} (not AppCompatActivity), so
 * per-app locales are applied through {@link Context#createConfigurationContext(Configuration)}
 * in {@code attachBaseContext} rather than through AppCompat's delegate.
 */
public final class LanguagePreference {
    static final String PREFERENCES = "humhum_settings";
    static final String KEY_LANGUAGE = "language";
    public static final String CHINESE = "zh";
    public static final String ENGLISH = "en";
    private static final String DEFAULT_LANGUAGE = CHINESE;

    private LanguagePreference() {}

    /** Returns the stored language tag ("zh" or "en"), defaulting to Chinese. */
    public static String getLanguage(Context context) {
        SharedPreferences preferences =
                context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String value = preferences.getString(KEY_LANGUAGE, DEFAULT_LANGUAGE);
        return ENGLISH.equals(value) ? ENGLISH : CHINESE;
    }

    /** Persists the language choice; unrecognized values fall back to Chinese. */
    public static void setLanguage(Context context, String language) {
        String normalized = ENGLISH.equals(language) ? ENGLISH : CHINESE;
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LANGUAGE, normalized)
                .apply();
    }

    /** Wraps {@code base} with a configuration that forces the stored locale. */
    public static Context wrap(Context base) {
        Locale locale = localeFor(getLanguage(base));
        Locale.setDefault(locale);
        Configuration configuration = new Configuration(base.getResources().getConfiguration());
        configuration.setLocale(locale);
        return base.createConfigurationContext(configuration);
    }

    private static Locale localeFor(String language) {
        return ENGLISH.equals(language) ? Locale.ENGLISH : Locale.SIMPLIFIED_CHINESE;
    }
}
